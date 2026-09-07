import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";

export const notesRoutes = new Hono<AppEnv>();

notesRoutes.use("*", authMiddleware);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── POST /append — add a line to today's note, creating it if needed ─────

notesRoutes.post("/append", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ text?: string; date?: string }>();

  const text = (body.text ?? "").trim();
  if (!text) return c.json({ error: "text is required" }, 400);

  // The client sends its own local date: a note written at 11pm belongs to
  // that evening, not to the server's tomorrow.
  const date = body.date ?? "";
  if (!ISO_DATE.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);

  const { data: existing } = await supabase
    .from("clips")
    .select("id, content")
    .eq("user_id", userId)
    .eq("source_type", "note")
    .eq("source_metadata->>noteDate", date)
    .is("deleted_at", null)
    .maybeSingle();

  let row: Record<string, unknown>;

  if (existing) {
    const merged = `${(existing.content as string) ?? ""}\n${text}`.trim();
    const { data, error } = await supabase
      .from("clips")
      .update({ content: merged, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error || !data) return c.json({ error: "Failed to append to note" }, 500);
    row = data as Record<string, unknown>;
  } else {
    const { data, error } = await supabase
      .from("clips")
      .insert({
        user_id: userId,
        source_type: "note",
        content: text,
        video_title: `Daily note · ${date}`,
        source_metadata: { noteDate: date },
        // Notes are authored, not processed — they are complete on arrival.
        status: "completed",
        enrichment_tier: "metadata",
        tags: [],
      })
      .select("*")
      .single();
    if (error || !data) return c.json({ error: "Failed to create note" }, 500);
    row = data as Record<string, unknown>;
  }

  // Re-embed on every write so semantic search reflects the note as it stands.
  await inngest.send({ name: "clip/embed.requested", data: { clipId: row.id as string } });
  return c.json({ note: toClip(row) });
});

// ── GET /today — fetch today's note, if there is one ────────────────────

notesRoutes.get("/today", async (c) => {
  const userId = c.get("userId");
  const date = c.req.query("date") ?? "";
  if (!ISO_DATE.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);

  const { data } = await supabase
    .from("clips")
    .select("*")
    .eq("user_id", userId)
    .eq("source_type", "note")
    .eq("source_metadata->>noteDate", date)
    .is("deleted_at", null)
    .maybeSingle();

  return c.json({ note: data ? toClip(data as Record<string, unknown>) : null });
});

// ── PATCH /:id — replace a note's body ──────────────────────────────────

notesRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ content?: string }>();
  if (typeof body.content !== "string") return c.json({ error: "content is required" }, 400);

  const { data, error } = await supabase
    .from("clips")
    .update({ content: body.content, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("source_type", "note")
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error || !data) return c.json({ error: "Note not found" }, 404);

  await inngest.send({ name: "clip/embed.requested", data: { clipId: id } });
  return c.json({ note: toClip(data as Record<string, unknown>) });
});
