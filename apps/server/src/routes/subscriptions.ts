import { Hono } from "hono";
import { MAX_SUBSCRIPTIONS_PER_USER, PRO_FEATURES } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { requirePro } from "../middleware/require-pro.js";
import { supabase } from "../lib/supabase.js";
import { toSubscription } from "../lib/mappers.js";
import { fetchChannelVideos, fetchPlaylistVideos, parseSourceUrl } from "../services/youtube.js";
import { refreshGoogleTokenIfNeeded, snapshotSeenVideos } from "../services/subscriptions.js";

export const subscriptionRoutes = new Hono<AppEnv>();

subscriptionRoutes.use("*", authMiddleware);

// GET / — list user's subscriptions
subscriptionRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: "Failed to fetch subscriptions" }, 500);
  return c.json({ subscriptions: (rows ?? []).map(toSubscription) });
});

// POST / — create subscription (Pro-only)
subscriptionRoutes.post("/", requirePro(PRO_FEATURES.AUTO_SUBSCRIBE), async (c) => {
  const userId = c.get("userId");

  let body: { type?: string; sourceUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validTypes = ["channel", "playlist", "watch_later"];
  if (!body.type || !validTypes.includes(body.type)) {
    return c.json({ error: "type must be channel, playlist, or watch_later" }, 400);
  }

  if (body.type !== "watch_later" && !body.sourceUrl) {
    return c.json({ error: "sourceUrl is required for channel and playlist subscriptions" }, 400);
  }

  // Enforce per-user subscription limit
  const { count } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
    return c.json({ error: `Maximum ${MAX_SUBSCRIPTIONS_PER_USER} subscriptions allowed` }, 422);
  }

  // Watch Later requires a connected Google account
  let accessToken: string | null = null;
  if (body.type === "watch_later") {
    const { data: tokenRow } = await supabase
      .from("user_google_tokens")
      .select("user_id")
      .eq("user_id", userId)
      .single();
    if (!tokenRow) {
      return c.json({ error: "Google account not connected", code: "google_not_connected" }, 403);
    }
    accessToken = await refreshGoogleTokenIfNeeded(userId);
    if (!accessToken) {
      return c.json(
        { error: "Google token expired, please reconnect", code: "google_not_connected" },
        403,
      );
    }
  }

  // Resolve URL to source metadata
  let resolved;
  try {
    const urlToResolve =
      body.type === "watch_later" ? "https://www.youtube.com/playlist?list=WL" : body.sourceUrl!;
    resolved = await parseSourceUrl(urlToResolve, accessToken ?? undefined);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid URL" }, 400);
  }

  // Check for duplicate subscription
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("type", resolved.type)
    .eq("source_id", resolved.sourceId ?? "WL")
    .limit(1)
    .maybeSingle();

  if (existing) {
    return c.json({ error: "Already subscribed to this source", code: "DUPLICATE" }, 409);
  }

  // Insert subscription row
  const { data: row, error: insertError } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      type: resolved.type,
      source_id: resolved.sourceId,
      source_name: resolved.sourceName,
      source_url: resolved.sourceUrl,
      is_active: true,
    })
    .select("*")
    .single();

  if (insertError || !row) {
    return c.json({ error: "Failed to create subscription" }, 500);
  }

  // Snapshot existing videos so first poll only queues new ones
  try {
    let initialVideos;
    if (resolved.type === "channel") {
      initialVideos = await fetchChannelVideos(resolved.sourceId!);
    } else {
      const playlistId = resolved.type === "watch_later" ? "WL" : resolved.sourceId!;
      initialVideos = await fetchPlaylistVideos(playlistId, accessToken ?? undefined);
    }
    await snapshotSeenVideos(
      row.id as string,
      initialVideos.map((v) => v.videoId),
    );
  } catch {
    // Non-fatal: worst case a few old videos get queued on first poll
  }

  return c.json({ subscription: toSubscription(row) }, 201);
});

// PATCH /:id — pause or resume
subscriptionRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  let body: { isActive?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const update: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") update.is_active = body.isActive;

  if (Object.keys(update).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const { data: row, error } = await supabase
    .from("subscriptions")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error || !row) return c.json({ error: "Subscription not found" }, 404);
  return c.json({ subscription: toSubscription(row) });
});

// DELETE /:id
subscriptionRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!existing) return c.json({ error: "Subscription not found" }, 404);

  await supabase.from("subscriptions").delete().eq("id", id);
  return c.json({ deleted: true });
});
