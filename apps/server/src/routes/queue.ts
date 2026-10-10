import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { requirePro } from "../middleware/require-pro.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { extractVideoId, PLAN_LIMITS, PRO_FEATURES } from "@cliphy/shared";
import { toSummary } from "../lib/mappers.js";
import { enqueueVideo } from "../services/enqueue-video.js";
import { resolveClipImage } from "../lib/storage.js";

// Columns to select on list/search queries — omits heavy vector + raw transcript columns.
const CLIP_LIST_COLS =
  "id, user_id, youtube_video_id, source_type, source_url, content, author, published_at, source_metadata, video_title, video_url, video_channel, video_duration_seconds, status, summary_json, summary_language, translations, error_message, tags, user_notes, deleted_at, created_at, updated_at";

// ─── Routes ────────────────────────────────────────────────

export const queueRoutes = new Hono<AppEnv>();

// All queue routes require authentication
queueRoutes.use("*", authMiddleware);

// GET / — List user's queue items
queueRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("clips")
    .select(CLIP_LIST_COLS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return c.json({ error: "Failed to fetch queue" }, 500);
  }

  const items = await Promise.all((rows ?? []).map((r) => resolveClipImage(toSummary(r))));
  return c.json({ items });
});

// GET /:id — Get specific queue item
queueRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: row, error } = await supabase
    .from("clips")
    .select(CLIP_LIST_COLS)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error || !row) {
    return c.json({ error: "Queue item not found" }, 404);
  }

  return c.json({ summary: toSummary(row) });
});

// POST / — Add a single video to the queue
queueRoutes.post("/", async (c) => {
  const userId = c.get("userId");

  let body: {
    videoUrl?: string;
    videoTitle?: string;
    videoChannel?: string;
    videoDurationSeconds?: number;
    transcript?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.videoUrl || typeof body.videoUrl !== "string") {
    return c.json({ error: "videoUrl is required" }, 400);
  }

  const result = await enqueueVideo({
    userId,
    videoUrl: body.videoUrl,
    videoTitle: body.videoTitle,
    videoChannel: body.videoChannel,
    videoDurationSeconds: body.videoDurationSeconds,
  });
  if (!result.ok) return c.json(result.body, result.status);

  return c.json({ summary: toSummary(result.row), position: result.position }, 201);
});

// POST /batch — Add multiple videos (Pro-only)
queueRoutes.post("/batch", requirePro(PRO_FEATURES.BATCH_QUEUE), async (c) => {
  const userId = c.get("userId");

  let body: { videos?: Array<{ videoUrl?: string }> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.videos) || body.videos.length === 0) {
    return c.json({ error: "videos array is required and must not be empty" }, 400);
  }

  if (body.videos.length > 10) {
    return c.json({ error: "Maximum 10 videos per batch" }, 400);
  }

  // Validate all URLs first
  const parsed: Array<{ videoId: string; videoUrl: string }> = [];
  for (const video of body.videos) {
    if (!video.videoUrl || typeof video.videoUrl !== "string") {
      return c.json({ error: "Each video must have a videoUrl" }, 400);
    }
    const videoId = extractVideoId(video.videoUrl);
    if (!videoId) {
      return c.json({ error: `Invalid YouTube URL: ${video.videoUrl}` }, 400);
    }
    parsed.push({ videoId, videoUrl: video.videoUrl });
  }

  // Deduplicate within the batch itself
  const uniqueByVideoId = new Map<string, { videoId: string; videoUrl: string }>();
  for (const item of parsed) {
    if (!uniqueByVideoId.has(item.videoId)) {
      uniqueByVideoId.set(item.videoId, item);
    }
  }
  const uniqueVideos = [...uniqueByVideoId.values()];

  // Check for existing duplicates in DB
  const videoIds = uniqueVideos.map((v) => v.videoId);
  const { data: existingRows } = await supabase
    .from("clips")
    .select("youtube_video_id")
    .eq("user_id", userId)
    .in("youtube_video_id", videoIds)
    .neq("status", "failed")
    .is("deleted_at", null);

  const existingSet = new Set((existingRows ?? []).map((r) => r.youtube_video_id as string));

  const toInsert = uniqueVideos.filter((v) => !existingSet.has(v.videoId));

  if (toInsert.length === 0) {
    return c.json({
      summaries: [],
      skipped: uniqueVideos.length,
    });
  }

  // Rate limit check — atomic batch increment via DB function
  const { data: batchUser } = await supabase
    .from("users")
    .select("monthly_limit_bonus")
    .eq("id", userId)
    .single();
  const limit = PLAN_LIMITS.pro + ((batchUser?.monthly_limit_bonus as number) ?? 0);
  const { data: allowed } = await supabase.rpc("increment_monthly_count_batch", {
    p_user_id: userId,
    p_limit: limit,
    p_count: toInsert.length,
  });

  const allowedCount = (allowed as number) ?? 0;

  if (allowedCount <= 0) {
    return c.json(
      {
        error: "Monthly summary limit reached",
        code: "RATE_LIMITED",
        limit,
        plan: "pro",
      },
      429,
    );
  }

  // Cap to what the rate limiter allowed
  const cappedInsert = toInsert.slice(0, allowedCount);
  const rateLimited = cappedInsert.length < toInsert.length;

  // Fetch user's preferred summary language
  const { data: batchSettingsRow } = await supabase
    .from("user_settings")
    .select("summary_language")
    .eq("user_id", userId)
    .single();
  const batchSummaryLanguage = (batchSettingsRow?.summary_language as string) ?? "en";

  // Bulk insert (titles/channels are backfilled by the worker from InnerTube)
  const { data: rows, error: insertError } = await supabase
    .from("clips")
    .insert(
      cappedInsert.map((v) => ({
        user_id: userId,
        youtube_video_id: v.videoId,
        video_url: v.videoUrl,
        summary_language: batchSummaryLanguage,
        status: "pending" as const,
      })),
    )
    .select("*");

  if (insertError || !rows) {
    // Rollback the rate limit increment since the insert failed
    await supabase.rpc("decrement_monthly_count_batch", {
      p_user_id: userId,
      p_count: cappedInsert.length,
    });
    return c.json({ error: "Failed to add videos to queue" }, 500);
  }

  // Fire Inngest events for each inserted row
  await inngest.send(
    rows.map((row) => ({
      name: "video/summarize.requested" as const,
      data: {
        summaryId: row.id as string,
        videoId: row.youtube_video_id as string,
        videoTitle: (row.video_title as string) ?? "Untitled Video",
        userId,
      },
    })),
  );

  return c.json(
    {
      summaries: rows.map(toSummary),
      added: rows.length,
      skipped: uniqueVideos.length - rows.length,
      ...(rateLimited && { rateLimited: true }),
    },
    201,
  );
});

// POST /:id/retry — Retry a queued item (fires Inngest event)
queueRoutes.post("/:id/retry", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: row, error: fetchError } = await supabase
    .from("clips")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fetchError || !row) {
    return c.json({ error: "Queue item not found" }, 404);
  }

  if (row.status !== "pending" && row.status !== "failed" && row.status !== "completed") {
    return c.json({ error: "Item must be in pending, failed, or completed state to retry" }, 409);
  }

  // Rate limit: failed always costs a slot, completed costs a slot for free users only
  const needsRateLimit =
    row.status === "failed" || (row.status === "completed" && /* free users pay */ true);

  if (needsRateLimit) {
    const { data: user } = await supabase
      .from("users")
      .select("plan, monthly_limit_bonus")
      .eq("id", userId)
      .single();
    const plan = (user?.plan as "free" | "pro") ?? "free";

    // Pro users can re-summarize completed items for free
    if (row.status === "completed" && plan === "pro") {
      // no-op: skip rate limit
    } else {
      const limit = PLAN_LIMITS[plan] + ((user?.monthly_limit_bonus as number) ?? 0);
      const { data: allowed } = await supabase.rpc("increment_monthly_count", {
        p_user_id: userId,
        p_limit: limit,
      });

      if (!allowed) {
        return c.json(
          { error: "Monthly summary limit reached", code: "RATE_LIMITED", limit, plan },
          429,
        );
      }
    }
  }

  // Fetch user's current language preference so regenerate respects the selected language
  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select("summary_language")
    .eq("user_id", userId)
    .single();
  const summaryLanguage = (settingsRow?.summary_language as string) ?? "en";

  // Reset to pending before re-firing (clear old summary for completed items)
  await supabase
    .from("clips")
    .update({
      status: "pending",
      error_message: null,
      summary_json: null,
      summary_language: summaryLanguage,
    })
    .eq("id", id);

  await inngest.send({
    name: "video/summarize.requested",
    data: {
      summaryId: id,
      videoId: row.youtube_video_id as string,
      videoTitle: (row.video_title as string) ?? "Untitled Video",
      userId,
    },
  });

  return c.json({
    summary: toSummary({ ...row, status: "pending", error_message: null, summary_json: null }),
  });
});

// DELETE /:id — Remove a queued item
queueRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  // Verify the item exists and belongs to the user
  const { data: row, error: fetchError } = await supabase
    .from("clips")
    .select("id, status, user_id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fetchError || !row) {
    return c.json({ error: "Queue item not found" }, 404);
  }

  // Don't allow deleting items that are currently being processed
  if (row.status === "processing") {
    return c.json({ error: "Cannot delete an item that is currently processing" }, 409);
  }

  const { error: deleteError } = await supabase
    .from("clips")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (deleteError) {
    return c.json({ error: "Failed to delete queue item" }, 500);
  }

  return c.json({ deleted: true });
});
