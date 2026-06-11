import { Hono } from "hono";
import { MAX_SUBSCRIPTIONS_PER_USER, PRO_FEATURES } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { requirePro } from "../middleware/require-pro.js";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { toSubscription } from "../lib/mappers.js";
import {
  fetchChannelVideos,
  fetchLikedVideos,
  fetchPlaylistVideos,
  parseSourceUrl,
  type ResolvedSource,
} from "../services/youtube.js";
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

  let body: { type?: string; sourceUrl?: string; importCount?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validTypes = ["channel", "playlist", "watch_later", "liked"];
  if (!body.type || !validTypes.includes(body.type)) {
    return c.json({ error: "type must be channel, playlist, watch_later, or liked" }, 400);
  }

  const isGoogleType = body.type === "watch_later" || body.type === "liked";
  if (!isGoogleType && !body.sourceUrl) {
    return c.json({ error: "sourceUrl is required for channel and playlist subscriptions" }, 400);
  }

  if (body.importCount !== undefined) {
    if (body.type !== "liked") {
      return c.json({ error: "importCount is only valid for liked subscriptions" }, 400);
    }
    if (!Number.isInteger(body.importCount) || body.importCount < 0 || body.importCount > 50) {
      return c.json({ error: "importCount must be an integer between 0 and 50" }, 400);
    }
  }

  // Enforce per-user subscription limit
  const { count } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
    return c.json({ error: `Maximum ${MAX_SUBSCRIPTIONS_PER_USER} subscriptions allowed` }, 422);
  }

  // Watch Later and Liked Videos require a connected Google account
  let accessToken: string | null = null;
  if (isGoogleType) {
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
  let resolved: ResolvedSource;
  if (body.type === "liked") {
    resolved = { type: "liked", sourceId: "LIKED", sourceName: "Liked Videos", sourceUrl: null };
  } else {
    try {
      const urlToResolve =
        body.type === "watch_later" ? "https://www.youtube.com/playlist?list=WL" : body.sourceUrl!;
      resolved = await parseSourceUrl(urlToResolve, accessToken ?? undefined);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Invalid URL" }, 400);
    }
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

  // Snapshot existing videos so first poll only queues new ones. For liked
  // with importCount, the N most recent likes stay out of the snapshot so the
  // immediate poll below queues them.
  const importCount = resolved.type === "liked" ? (body.importCount ?? 0) : 0;
  try {
    let initialVideos;
    if (resolved.type === "channel") {
      initialVideos = await fetchChannelVideos(resolved.sourceId!);
    } else if (resolved.type === "liked") {
      initialVideos = await fetchLikedVideos(accessToken!);
    } else {
      const playlistId = resolved.type === "watch_later" ? "WL" : resolved.sourceId!;
      initialVideos = await fetchPlaylistVideos(playlistId, accessToken ?? undefined);
    }
    const toSnapshot = importCount > 0 ? initialVideos.slice(importCount) : initialVideos;
    await snapshotSeenVideos(
      row.id as string,
      toSnapshot.map((v) => v.videoId),
    );
  } catch {
    // Non-fatal: worst case a few old videos get queued on first poll
  }

  if (importCount > 0) {
    try {
      await inngest.send({
        name: "subscription/poll.requested",
        data: { subscriptionId: row.id as string },
      });
    } catch {
      // Non-fatal: the next cron cycle polls anyway
    }
  }

  return c.json({ subscription: toSubscription(row) }, 201);
});

// POST /refresh — dispatch immediate polls for the user's active subscriptions.
// Called by the app on launch/foreground/pull-to-refresh so new likes and
// playlist saves show up right away instead of waiting for the 15-min cron.
// Throttled: subscriptions checked within the last 2 minutes are skipped.
subscriptionRoutes.post("/refresh", async (c) => {
  const userId = c.get("userId");
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, last_checked_at")
    .eq("user_id", userId)
    .eq("is_active", true);

  const due = (subs ?? []).filter(
    (s) => !s.last_checked_at || (s.last_checked_at as string) < cutoff,
  );

  if (due.length > 0) {
    await inngest.send(
      due.map((s) => ({
        name: "subscription/poll.requested" as const,
        data: { subscriptionId: s.id as string },
      })),
    );
  }

  return c.json({ refreshed: due.length });
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
