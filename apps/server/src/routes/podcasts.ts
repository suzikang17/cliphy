import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { parseFeedMetadata } from "../services/rss.js";
import type {
  PodcastEpisode,
  PodcastEpisodeStatus,
  PodcastFeed,
  PodcastFeedSettings,
} from "@cliphy/shared";

export const podcastRoutes = new Hono<AppEnv>();

podcastRoutes.use("*", authMiddleware);

// ─── Mappers ────────────────────────────────────────────────

function toPodcastFeed(row: Record<string, unknown>): PodcastFeed {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    rssUrl: row.rss_url as string,
    title: row.title as string,
    author: (row.author as string) ?? undefined,
    artworkUrl: (row.artwork_url as string) ?? undefined,
    autoQueue: row.auto_queue as boolean,
    minDurationSeconds: (row.min_duration_seconds as number) ?? undefined,
    maxDurationSeconds: (row.max_duration_seconds as number) ?? undefined,
    lastPolledAt: (row.last_polled_at as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function toPodcastEpisode(row: Record<string, unknown>): PodcastEpisode {
  return {
    id: row.id as string,
    feedId: row.feed_id as string,
    userId: row.user_id as string,
    guid: row.guid as string,
    title: row.title as string,
    description: (row.description as string) ?? undefined,
    audioUrl: row.audio_url as string,
    artworkUrl: (row.artwork_url as string) ?? undefined,
    durationSeconds: (row.duration_seconds as number) ?? undefined,
    publishedAt: row.published_at as string,
    status: row.status as PodcastEpisodeStatus,
    clipId: (row.clip_id as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

// ─── Routes ─────────────────────────────────────────────────

// POST /feeds — Subscribe to a podcast RSS feed
podcastRoutes.post("/feeds", async (c) => {
  const userId = c.get("userId");

  let body: { rssUrl?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.rssUrl || typeof body.rssUrl !== "string") {
    return c.json({ error: "rssUrl is required" }, 400);
  }

  try {
    new URL(body.rssUrl);
  } catch {
    return c.json({ error: "rssUrl is not a valid URL" }, 400);
  }

  let metadata: { title: string; author?: string; artworkUrl?: string };
  try {
    metadata = await parseFeedMetadata(body.rssUrl);
  } catch (err) {
    return c.json({ error: `Invalid RSS feed: ${(err as Error).message}` }, 400);
  }

  // Check for existing subscription before inserting
  const { data: existing } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("user_id", userId)
    .eq("rss_url", body.rssUrl)
    .maybeSingle();

  if (existing) {
    return c.json({ error: "Already subscribed to this feed" }, 409);
  }

  const { data: row, error } = await supabase
    .from("podcast_feeds")
    .insert({
      user_id: userId,
      rss_url: body.rssUrl,
      title: metadata.title,
      author: metadata.author ?? null,
      artwork_url: metadata.artworkUrl ?? null,
      auto_queue: true,
    })
    .select("*")
    .single();

  if (error || !row) {
    if (error?.code === "23505") {
      return c.json({ error: "Already subscribed to this feed" }, 409);
    }
    return c.json({ error: "Failed to add podcast feed" }, 500);
  }

  return c.json({ feed: toPodcastFeed(row as Record<string, unknown>) }, 201);
});

// GET /feeds — List the user's podcast feeds
podcastRoutes.get("/feeds", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("podcast_feeds")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return c.json({ error: "Failed to fetch podcast feeds" }, 500);
  }

  return c.json({ feeds: (rows ?? []).map((r) => toPodcastFeed(r as Record<string, unknown>)) });
});

// PATCH /feeds/:id — Update feed settings (auto_queue, duration filters)
podcastRoutes.patch("/feeds/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: existing } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    return c.json({ error: "Podcast feed not found" }, 404);
  }

  let body: PodcastFeedSettings;
  try {
    body = await c.req.json<PodcastFeedSettings>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const update: Record<string, unknown> = {};
  if (body.autoQueue !== undefined) update.auto_queue = body.autoQueue;
  if (body.minDurationSeconds !== undefined) update.min_duration_seconds = body.minDurationSeconds;
  if (body.maxDurationSeconds !== undefined) update.max_duration_seconds = body.maxDurationSeconds;

  if (Object.keys(update).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const { data: row, error } = await supabase
    .from("podcast_feeds")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error || !row) {
    return c.json({ error: "Failed to update podcast feed" }, 500);
  }

  return c.json({ feed: toPodcastFeed(row as Record<string, unknown>) });
});

// DELETE /feeds/:id — Unsubscribe (cascade deletes episodes)
podcastRoutes.delete("/feeds/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: existing } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    return c.json({ error: "Podcast feed not found" }, 404);
  }

  const { error } = await supabase
    .from("podcast_feeds")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return c.json({ error: "Failed to delete podcast feed" }, 500);
  }

  return c.json({ deleted: true });
});

// GET /feeds/:id/episodes — List episodes for a feed
podcastRoutes.get("/feeds/:id/episodes", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: feed } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!feed) {
    return c.json({ error: "Podcast feed not found" }, 404);
  }

  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  let query = supabase
    .from("podcast_episodes")
    .select("*", { count: "exact" })
    .eq("feed_id", id)
    .eq("user_id", userId)
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data: rows, error, count } = await query;

  if (error) {
    return c.json({ error: "Failed to fetch episodes" }, 500);
  }

  return c.json({
    episodes: (rows ?? []).map((r) => toPodcastEpisode(r as Record<string, unknown>)),
    total: count ?? 0,
  });
});

// POST /feeds/:id/refresh — Trigger an on-demand poll for a specific feed
podcastRoutes.post("/feeds/:id/refresh", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: feed } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!feed) {
    return c.json({ error: "Podcast feed not found" }, 404);
  }

  await inngest.send({ name: "podcast/feed.poll", data: { feedId: id, userId } });

  return c.json({ queued: true });
});

// POST /episodes/:id/queue — Approve a pending_approval episode for transcription
podcastRoutes.post("/episodes/:id/queue", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: episode, error: fetchError } = await supabase
    .from("podcast_episodes")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError || !episode) {
    return c.json({ error: "Episode not found" }, 404);
  }

  if ((episode.status as string) !== "pending_approval") {
    return c.json({ error: "Episode must be in pending_approval status to queue" }, 409);
  }

  const { data: row, error: updateError } = await supabase
    .from("podcast_episodes")
    .update({ status: "queued" })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (updateError || !row) {
    return c.json({ error: "Failed to queue episode" }, 500);
  }

  await inngest.send({ name: "podcast/episode.transcribe", data: { episodeId: id } });

  return c.json({ episode: toPodcastEpisode(row as Record<string, unknown>) });
});

// POST /episodes/:id/skip — Skip an episode
podcastRoutes.post("/episodes/:id/skip", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: episode } = await supabase
    .from("podcast_episodes")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!episode) {
    return c.json({ error: "Episode not found" }, 404);
  }

  const { data: row, error } = await supabase
    .from("podcast_episodes")
    .update({ status: "skipped" })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error || !row) {
    return c.json({ error: "Failed to skip episode" }, 500);
  }

  return c.json({ episode: toPodcastEpisode(row as Record<string, unknown>) });
});

// POST /import/opml — Bulk-import podcast feeds from an OPML file
podcastRoutes.post("/import/opml", async (c) => {
  const userId = c.get("userId");
  const opml = await c.req.text();

  if (!opml) {
    return c.json({ error: "OPML body is required" }, 400);
  }

  // Extract all <outline> elements that carry an xmlUrl attribute
  const matches = [...opml.matchAll(/<outline[^>]+xmlUrl=["']([^"']+)["'][^>]*/gi)];
  if (matches.length === 0) {
    return c.json({ error: "No RSS feeds found in OPML" }, 400);
  }

  const urls = [...new Set(matches.map((m) => m[1]).filter(Boolean))];

  let imported = 0;
  let skipped = 0;
  const feeds: PodcastFeed[] = [];

  for (const rssUrl of urls) {
    try {
      const metadata = await parseFeedMetadata(rssUrl);

      const { data: row, error } = await supabase
        .from("podcast_feeds")
        .insert({
          user_id: userId,
          rss_url: rssUrl,
          title: metadata.title,
          author: metadata.author ?? null,
          artwork_url: metadata.artworkUrl ?? null,
          auto_queue: true,
        })
        .select("*")
        .single();

      if (error) {
        skipped++;
      } else if (row) {
        imported++;
        feeds.push(toPodcastFeed(row as Record<string, unknown>));
      }
    } catch {
      skipped++;
    }
  }

  return c.json({ imported, skipped, feeds });
});
