import { Hono } from "hono";
import type { VideoDigestItem, VideoDigestResponse, SummaryJson } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { enqueueVideo } from "../services/enqueue-video.js";

// The weekly digest (ADR 0072): read it, keep a video, or wave one away.

export const digestRoutes = new Hono<AppEnv>();

digestRoutes.use("*", authMiddleware);

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

// GET / — the newest digest: its videos that have not been dismissed
digestRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const [{ data: settings }, { data: newest }] = await Promise.all([
    supabase.from("user_settings").select("weekly_digest").eq("user_id", userId).maybeSingle(),
    supabase
      .from("digest_items")
      .select("digest_date")
      .eq("user_id", userId)
      .order("digest_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const enabled = settings?.weekly_digest === true;
  const digestDate = (newest?.digest_date as string | undefined) ?? null;
  if (!digestDate)
    return c.json({ enabled, digestDate: null, items: [] } satisfies VideoDigestResponse);

  const { data: rows, error } = await supabase
    .from("digest_items")
    .select(
      "id, youtube_video_id, video_title, video_channel, published_at, score, because_clip_id, summary_json, kept_clip_id",
    )
    .eq("user_id", userId)
    .eq("digest_date", digestDate)
    .is("dismissed_at", null)
    .order("score", { ascending: false });
  if (error) return c.json({ error: "Failed to fetch digest" }, 500);

  const becauseIds = [...new Set((rows ?? []).map((r) => r.because_clip_id).filter(Boolean))];
  const titles = new Map<string, string>();
  if (becauseIds.length > 0) {
    const { data: clips } = await supabase
      .from("clips")
      .select("id, video_title")
      .eq("user_id", userId)
      .in("id", becauseIds as string[]);
    for (const clip of clips ?? []) {
      if (clip.video_title) titles.set(clip.id as string, clip.video_title as string);
    }
  }

  const items: VideoDigestItem[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    videoId: r.youtube_video_id as string,
    videoUrl: watchUrl(r.youtube_video_id as string),
    title: r.video_title as string,
    channel: (r.video_channel as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    summaryJson: r.summary_json as SummaryJson,
    becauseTitle: titles.get(r.because_clip_id as string) ?? null,
    keptClipId: (r.kept_clip_id as string | null) ?? null,
  }));
  return c.json({ enabled, digestDate, items } satisfies VideoDigestResponse);
});

// POST /:id/keep — save the video to the library, through the normal queue
digestRoutes.post("/:id/keep", async (c) => {
  const userId = c.get("userId");
  const { data: item } = await supabase
    .from("digest_items")
    .select("id, youtube_video_id, video_title, video_channel, kept_clip_id")
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .maybeSingle();
  if (!item) return c.json({ error: "Digest item not found" }, 404);
  if (item.kept_clip_id) return c.json({ clipId: item.kept_clip_id });

  const result = await enqueueVideo({
    userId,
    videoUrl: watchUrl(item.youtube_video_id as string),
    videoTitle: item.video_title as string,
    videoChannel: (item.video_channel as string | null) ?? undefined,
  });
  if (!result.ok) return c.json(result.body, result.status);

  const clipId = result.row.id as string;
  await supabase.from("digest_items").update({ kept_clip_id: clipId }).eq("id", item.id);
  return c.json({ clipId }, 201);
});

// POST /:id/dismiss — take the video out of the digest
digestRoutes.post("/:id/dismiss", async (c) => {
  const userId = c.get("userId");
  const { data: row } = await supabase
    .from("digest_items")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (!row) return c.json({ error: "Digest item not found" }, 404);
  return c.json({ dismissed: true });
});
