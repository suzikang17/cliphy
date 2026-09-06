import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { toPinnedItem } from "../lib/mappers.js";
import { sanitizeViewQuery, runViewQuery } from "../services/viewQuery.js";

export const pinsRoutes = new Hono<AppEnv>();

pinsRoutes.use("*", authMiddleware);

// ── GET / — all pins for the user, grid order ────────────────

pinsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("pinned_items")
    .select("*")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) return c.json({ error: "Failed to load pins" }, 500);
  return c.json({ pins: (data ?? []).map((r) => toPinnedItem(r as Record<string, unknown>)) });
});

// ── POST /reorder — rewrite positions into a dense sequence ───
// Registered BEFORE /:id so "reorder" is not captured as an :id param.

pinsRoutes.post("/reorder", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ ids?: string[] }>();
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "ids is required" }, 400);
  }
  // ~20 pins per user, so rewriting the list is cheaper than fractional
  // indexing. See the spec's "Why these shapes" before changing this.
  for (const [index, id] of body.ids.entries()) {
    const { error } = await supabase
      .from("pinned_items")
      .update({ position: index })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) return c.json({ error: "Failed to reorder pins" }, 500);
  }
  return c.json({ ok: true });
});

// ── POST / — pin a clip or a view ────────────────────────────

pinsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    kind?: string;
    layout?: string;
    label?: string;
    iconUrl?: string;
    clipId?: string;
    viewQuery?: unknown;
    position?: number;
  }>();

  if (body.kind !== "clip" && body.kind !== "view") {
    return c.json({ error: "kind must be 'clip' or 'view'" }, 400);
  }
  if (body.kind === "clip" && !body.clipId) {
    return c.json({ error: "clipId is required for a clip pin" }, 400);
  }
  if (body.kind === "view" && !body.viewQuery) {
    return c.json({ error: "viewQuery is required for a view pin" }, 400);
  }

  const layout = body.layout === "panel" ? "panel" : "tile";
  const insert: Record<string, unknown> = {
    user_id: userId,
    kind: body.kind,
    layout,
    position: body.position ?? 0,
    label: body.label ?? null,
    icon_url: body.iconUrl ?? null,
    clip_id: body.kind === "clip" ? body.clipId : null,
    view_query: body.kind === "view" ? sanitizeViewQuery(body.viewQuery) : null,
  };

  const { data, error } = await supabase.from("pinned_items").insert(insert).select("*").single();
  if (error || !data) return c.json({ error: "Failed to create pin" }, 500);
  return c.json({ pin: toPinnedItem(data as Record<string, unknown>) }, 201);
});

// ── GET /:id/items — resolve a panel's contents ──────────────

pinsRoutes.get("/:id/items", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("pinned_items")
    .select("*")
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .single();
  if (error || !data) return c.json({ error: "Pin not found" }, 404);

  const pin = toPinnedItem(data as Record<string, unknown>);
  if (pin.kind !== "view") return c.json({ error: "Pin is not a view" }, 400);

  const clips = await runViewQuery(userId, sanitizeViewQuery(pin.viewQuery));
  return c.json({ clips });
});

// ── PATCH /:id — rename, re-icon, or switch tile/panel ───────

pinsRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    label?: string;
    iconUrl?: string;
    layout?: string;
    viewQuery?: unknown;
  }>();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.label !== undefined) patch.label = body.label;
  if (body.iconUrl !== undefined) patch.icon_url = body.iconUrl;
  if (body.layout === "tile" || body.layout === "panel") patch.layout = body.layout;
  if (body.viewQuery !== undefined) patch.view_query = sanitizeViewQuery(body.viewQuery);

  const { data, error } = await supabase
    .from("pinned_items")
    .update(patch)
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) return c.json({ error: "Failed to update pin" }, 500);
  return c.json({ pin: toPinnedItem(data as Record<string, unknown>) });
});

// ── DELETE /:id — unpin ──────────────────────────────────────

pinsRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { error } = await supabase
    .from("pinned_items")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("user_id", userId);
  if (error) return c.json({ error: "Failed to delete pin" }, 500);
  return c.json({ ok: true });
});
