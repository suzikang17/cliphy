import { randomUUID } from "crypto";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";

export const notesRoutes = new Hono<AppEnv>();

notesRoutes.use("*", authMiddleware);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Recordings share the clips' private bucket, under their own folder. */
const VOICE_BUCKET = "clip-images";

/** A title for something written or said: its first line, cut at a word. */
export function titleFrom(text: string, max = 70): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : max).trimEnd()}…`;
}

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

// ── POST / — a note of its own, apart from the day's running note ────────

notesRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text is required" }, 400);

  const { data, error } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      source_type: "note",
      content: text,
      video_title: titleFrom(text),
      // No noteDate: only the day's running note has one.
      source_metadata: {},
      status: "completed",
      enrichment_tier: "metadata",
      tags: [],
    })
    .select("*")
    .single();
  if (error || !data) return c.json({ error: "Failed to save note" }, 500);
  const row = data as Record<string, unknown>;
  // The same job that makes it searchable also reads it and tags it.
  await inngest.send({ name: "clip/embed.requested", data: { clipId: row.id as string } });
  return c.json({ note: toClip(row) }, 201);
});

// ── Voice notes ──────────────────────────────────────────────────────────
// The recording goes straight to storage from the phone or browser; then the
// clip is made and a job transcribes it. Its words are tagged like any clip.

/** The kinds of audio a phone or a browser records, and the file ending for each. */
const AUDIO_TYPES: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};
/** "audio/webm;codecs=opus" → "audio/webm". */
const baseType = (mediaType: unknown): string =>
  typeof mediaType === "string" ? mediaType.split(";")[0].trim().toLowerCase() : "";

notesRoutes.post("/voice/upload-url", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{ mediaType?: unknown }>()
    .catch(() => ({}) as { mediaType?: unknown });
  const ext = AUDIO_TYPES[baseType(body.mediaType)];
  if (!ext) return c.json({ error: "unsupported audio type" }, 400);

  const path = `voice/${userId}/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(VOICE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return c.json({ error: "Failed to create upload url" }, 500);
  return c.json({ path, signedUrl: data.signedUrl, token: data.token });
});

notesRoutes.post("/voice", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{ storagePath?: unknown; mediaType?: unknown; seconds?: unknown }>()
    .catch(() => ({}) as { storagePath?: unknown; mediaType?: unknown; seconds?: unknown });
  const path = typeof body.storagePath === "string" ? body.storagePath : "";
  if (!path.startsWith(`voice/${userId}/`) || path.split("/").includes("..")) {
    return c.json({ error: "invalid recording path" }, 400);
  }
  const mediaType = baseType(body.mediaType);
  if (!AUDIO_TYPES[mediaType]) return c.json({ error: "unsupported audio type" }, 400);
  const seconds =
    typeof body.seconds === "number" && Number.isFinite(body.seconds) && body.seconds > 0
      ? body.seconds
      : null;

  const { data, error } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      source_type: "voice",
      content: "",
      video_title: "Voice note",
      source_metadata: { storagePath: path, mediaType, ...(seconds ? { seconds } : {}) },
      // Its words arrive when the transcription job finishes.
      status: "processing",
      enrichment_tier: "full",
      tags: [],
    })
    .select("*")
    .single();
  if (error || !data) return c.json({ error: "Failed to save voice note" }, 500);
  const row = data as Record<string, unknown>;
  await inngest.send({ name: "voice/note.transcribe", data: { clipId: row.id as string } });
  return c.json({ note: toClip(row) }, 201);
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
