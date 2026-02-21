import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { PLAN_LIMITS } from "@cliphy/shared";
import type { Summary } from "@cliphy/shared";

// ─── Helpers ───────────────────────────────────────────────

/**
 * Extract YouTube video ID from various URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://youtube.com/v/VIDEO_ID
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace("www.", "");

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      // /watch?v=VIDEO_ID
      const vParam = parsed.searchParams.get("v");
      if (vParam) return vParam;

      // /embed/VIDEO_ID, /v/VIDEO_ID, /shorts/VIDEO_ID
      const pathMatch = parsed.pathname.match(/^\/(embed|v|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch) return pathMatch[2];

      return null;
    }

    if (hostname === "youtu.be") {
      const id = parsed.pathname.slice(1); // remove leading /
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    return null;
  } catch {
    return null;
  }
}

/** Map a DB row (snake_case) to a Summary object (camelCase). */
function toSummary(row: Record<string, unknown>): Summary {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    videoId: row.youtube_video_id as string,
    videoTitle: (row.video_title as string) ?? undefined,
    videoUrl: (row.video_url as string) ?? undefined,
    status: row.status as Summary["status"],
    summaryJson: (row.summary_json as Summary["summaryJson"]) ?? undefined,
    errorMessage: (row.error_message as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── Routes ────────────────────────────────────────────────

export const queueRoutes = new Hono<AppEnv>();

// All queue routes require authentication
queueRoutes.use("*", authMiddleware);

// GET / — List user's queue items
queueRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("summaries")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return c.json({ error: "Failed to fetch queue" }, 500);
  }

  return c.json({ items: (rows ?? []).map(toSummary) });
});

// GET /:id — Get specific queue item
queueRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: row, error } = await supabase
    .from("summaries")
    .select("*")
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

  let body: { videoUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.videoUrl || typeof body.videoUrl !== "string") {
    return c.json({ error: "videoUrl is required" }, 400);
  }

  const videoId = extractVideoId(body.videoUrl);
  if (!videoId) {
    return c.json({ error: "Invalid YouTube URL" }, 400);
  }

  // Duplicate check: same user + same video + not failed
  const { data: existing } = await supabase
    .from("summaries")
    .select("id, status")
    .eq("user_id", userId)
    .eq("youtube_video_id", videoId)
    .neq("status", "failed")
    .limit(1)
    .maybeSingle();

  if (existing) {
    return c.json({ error: "Video already queued", code: "DUPLICATE" }, 409);
  }

  // Rate limit check — atomic increment via DB function
  const { data: user } = await supabase.from("users").select("plan").eq("id", userId).single();

  const plan = (user?.plan as "free" | "pro") ?? "free";
  const limit = PLAN_LIMITS[plan];

  const { data: allowed } = await supabase.rpc("increment_daily_count", {
    p_user_id: userId,
    p_limit: limit,
  });

  if (!allowed) {
    return c.json(
      {
        error: "Daily summary limit reached",
        code: "RATE_LIMITED",
        limit,
        plan,
      },
      429,
    );
  }

  // Insert new queue item
  const { data: row, error: insertError } = await supabase
    .from("summaries")
    .insert({
      user_id: userId,
      youtube_video_id: videoId,
      video_url: body.videoUrl,
      status: "pending",
    })
    .select("*")
    .single();

  if (insertError || !row) {
    return c.json({ error: "Failed to add to queue" }, 500);
  }

  // Calculate queue position (number of pending/processing items created before this one)
  const { count } = await supabase
    .from("summaries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["pending", "processing"])
    .lt("created_at", row.created_at);

  const summary = toSummary(row);

  return c.json({ summary, position: (count ?? 0) + 1 }, 201);
});

// POST /batch — Add multiple videos (Pro-only)
queueRoutes.post("/batch", async (c) => {
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

  // Check user plan — Pro only
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("plan, daily_summary_count, daily_count_reset_at")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    return c.json({ error: "User not found" }, 404);
  }

  if (user.plan !== "pro") {
    return c.json({ error: "Batch queue is a Pro feature" }, 403);
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
    .from("summaries")
    .select("youtube_video_id")
    .eq("user_id", userId)
    .in("youtube_video_id", videoIds)
    .neq("status", "failed");

  const existingSet = new Set((existingRows ?? []).map((r) => r.youtube_video_id as string));

  const toInsert = uniqueVideos.filter((v) => !existingSet.has(v.videoId));

  if (toInsert.length === 0) {
    return c.json({
      summaries: [],
      skipped: uniqueVideos.length,
    });
  }

  // Rate limit check — calculate remaining capacity and cap the batch
  const limit = PLAN_LIMITS.pro;
  const today = new Date().toISOString().slice(0, 10);
  const currentUsed =
    (user.daily_count_reset_at as string) < today ? 0 : (user.daily_summary_count as number);
  const remaining = limit - currentUsed;

  if (remaining <= 0) {
    return c.json(
      {
        error: "Daily summary limit reached",
        code: "RATE_LIMITED",
        limit,
        plan: "pro",
      },
      429,
    );
  }

  // Cap to remaining capacity
  const cappedInsert = toInsert.slice(0, remaining);
  const rateLimited = cappedInsert.length < toInsert.length;

  // Increment usage count for the items we're about to insert
  await supabase
    .from("users")
    .update({
      daily_summary_count: currentUsed + cappedInsert.length,
      daily_count_reset_at: today,
    })
    .eq("id", userId);

  // Bulk insert
  const { data: rows, error: insertError } = await supabase
    .from("summaries")
    .insert(
      cappedInsert.map((v) => ({
        user_id: userId,
        youtube_video_id: v.videoId,
        video_url: v.videoUrl,
        status: "pending" as const,
      })),
    )
    .select("*");

  if (insertError || !rows) {
    return c.json({ error: "Failed to add videos to queue" }, 500);
  }

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

// DELETE /:id — Remove a queued item
queueRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  // Verify the item exists and belongs to the user
  const { data: row, error: fetchError } = await supabase
    .from("summaries")
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
    .from("summaries")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (deleteError) {
    return c.json({ error: "Failed to delete queue item" }, 500);
  }

  return c.json({ deleted: true });
});
