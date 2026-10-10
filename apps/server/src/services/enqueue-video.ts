import {
  DEDUP_WINDOW_SECONDS,
  extractVideoId,
  MAX_VIDEO_DURATION_SECONDS,
  PLAN_LIMITS,
} from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { MAX_LENGTHS } from "../lib/validation.js";

export interface EnqueueVideoInput {
  userId: string;
  videoUrl: string;
  videoTitle?: string;
  videoChannel?: string;
  videoDurationSeconds?: number;
}

export type EnqueueVideoResult =
  | { ok: true; row: Record<string, unknown>; position: number }
  | { ok: false; status: 400 | 409 | 429 | 500; body: Record<string, unknown> };

/**
 * Create a pending YouTube clip and fire the summarize event. Shared by
 * POST /queue and the universal POST /clips ingest, so every client that saves
 * a YouTube URL gets it summarized.
 */
export async function enqueueVideo(input: EnqueueVideoInput): Promise<EnqueueVideoResult> {
  const { userId, videoUrl, videoTitle, videoChannel, videoDurationSeconds } = input;

  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    return { ok: false, status: 400, body: { error: "Invalid YouTube URL" } };
  }

  if (videoTitle && videoTitle.length > MAX_LENGTHS.videoTitle) {
    return {
      ok: false,
      status: 400,
      body: { error: `videoTitle exceeds ${MAX_LENGTHS.videoTitle} characters` },
    };
  }
  if (videoChannel && videoChannel.length > MAX_LENGTHS.videoChannel) {
    return {
      ok: false,
      status: 400,
      body: { error: `videoChannel exceeds ${MAX_LENGTHS.videoChannel} characters` },
    };
  }
  if (
    typeof videoDurationSeconds === "number" &&
    (videoDurationSeconds < 0 || videoDurationSeconds > MAX_VIDEO_DURATION_SECONDS)
  ) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Video is too long (max 4 hours). Try a shorter video.",
        code: "VIDEO_TOO_LONG",
      },
    };
  }

  // Windowed duplicate check: same user + same video + active, enqueued within
  // the dedup window. Collapses accidental rapid re-submits (e.g. the share
  // sheet firing 2-3×) without permanently blocking a later re-summarize. This
  // is the fast path; the atomic guard is the partial unique index on
  // (user_id, youtube_video_id, dedup_bucket), which closes the TOCTOU race
  // below where concurrent requests both pass this check.
  const dedupBucket = Math.floor(Date.now() / 1000 / DEDUP_WINDOW_SECONDS);
  const windowStart = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000).toISOString();

  const { data: existing } = await supabase
    .from("clips")
    .select("id, status")
    .eq("user_id", userId)
    .eq("youtube_video_id", videoId)
    .neq("status", "failed")
    .is("deleted_at", null)
    .gte("created_at", windowStart)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { ok: false, status: 409, body: { error: "Video already queued", code: "DUPLICATE" } };
  }

  // Rate limit check — atomic increment via DB function
  const { data: user } = await supabase
    .from("users")
    .select("plan, monthly_limit_bonus")
    .eq("id", userId)
    .single();

  const plan = (user?.plan as "free" | "pro") ?? "free";
  // Effective monthly cap = plan limit + recurring admin bonus. The RPC draws
  // from the one-off bonus_credits wallet automatically once this is exhausted.
  const limit = PLAN_LIMITS[plan] + ((user?.monthly_limit_bonus as number) ?? 0);

  const { data: allowed } = await supabase.rpc("increment_monthly_count", {
    p_user_id: userId,
    p_limit: limit,
  });

  if (!allowed) {
    return {
      ok: false,
      status: 429,
      body: { error: "Monthly summary limit reached", code: "RATE_LIMITED", limit, plan },
    };
  }

  // Title/channel come from the client when available; otherwise the summarize
  // worker backfills them from the InnerTube response it already fetches.

  // Fetch user's preferred summary language
  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select("summary_language")
    .eq("user_id", userId)
    .single();
  const summaryLanguage = (settingsRow?.summary_language as string) ?? "en";

  // Insert new queue item
  const { data: row, error: insertError } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      youtube_video_id: videoId,
      video_title: videoTitle || null,
      video_channel: videoChannel || null,
      video_duration_seconds: videoDurationSeconds ?? null,
      video_url: videoUrl,
      summary_language: summaryLanguage,
      status: "pending",
      dedup_bucket: dedupBucket,
    })
    .select("*")
    .single();

  if (insertError || !row) {
    // Rollback the rate limit increment since the insert failed
    await supabase.rpc("decrement_monthly_count", { p_user_id: userId });

    // A concurrent request already queued this video — the partial unique index
    // (summaries_user_video_active_uniq) fired. The SELECT-based check above is
    // racy under concurrency (TOCTOU); this is the authoritative dedup guard.
    if (insertError?.code === "23505") {
      return { ok: false, status: 409, body: { error: "Video already queued", code: "DUPLICATE" } };
    }
    return { ok: false, status: 500, body: { error: "Failed to add to queue" } };
  }

  // Fire Inngest event for async processing. The event `id` makes ingestion
  // idempotent: under Inngest's at-least-once delivery, a redelivered enqueue
  // event won't trigger a second summarization. Keyed on the row id (unique per
  // enqueue), so it never collides with a retry of the same summary (the retry
  // path sends its own event) — re-summarizing still runs.
  await inngest.send({
    id: `summarize-${row.id as string}`,
    name: "video/summarize.requested",
    data: {
      summaryId: row.id as string,
      videoId,
      videoTitle: (row.video_title as string) ?? "Untitled Video",
      userId,
    },
  });

  // Calculate queue position (number of pending/processing items created before this one)
  const { count } = await supabase
    .from("clips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["pending", "processing"])
    .lt("created_at", row.created_at);

  return { ok: true, row, position: (count ?? 0) + 1 };
}
