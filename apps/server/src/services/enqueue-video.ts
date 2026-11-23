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
  /** Count the items ahead of this one. Only POST /queue shows it; others skip the count. */
  wantPosition?: boolean;
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

  // One trip to the database (migration 049, `enqueue_video`): the windowed
  // duplicate check (same user + video + active within the window, which
  // collapses the share sheet firing 2-3× without blocking a later
  // re-summarize), the monthly limit (plan + recurring bonus, then the one-off
  // credit wallet), the user's summary language, and the insert. A concurrent
  // share that loses the race to the unique index on (user, video, bucket)
  // comes back as a duplicate with its count undone.
  // Title/channel come from the client when available; otherwise the summarize
  // worker backfills them from the InnerTube response it already fetches.
  const { data, error } = await supabase.rpc("enqueue_video", {
    p_user_id: userId,
    p_video_id: videoId,
    p_video_url: videoUrl,
    p_video_title: videoTitle ?? null,
    p_video_channel: videoChannel ?? null,
    p_duration_seconds: videoDurationSeconds ?? null,
    p_limits: PLAN_LIMITS,
    p_window_seconds: DEDUP_WINDOW_SECONDS,
    p_want_position: Boolean(input.wantPosition),
  });
  const saved = data as
    | { outcome: "duplicate" }
    | { outcome: "limited"; limit: number; plan: string }
    | { outcome: "ok"; row: Record<string, unknown>; position: number }
    | null;

  if (error || !saved) {
    return { ok: false, status: 500, body: { error: "Failed to add to queue" } };
  }
  if (saved.outcome === "duplicate") {
    return { ok: false, status: 409, body: { error: "Video already queued", code: "DUPLICATE" } };
  }
  if (saved.outcome === "limited") {
    return {
      ok: false,
      status: 429,
      body: {
        error: "Monthly summary limit reached",
        code: "RATE_LIMITED",
        limit: saved.limit,
        plan: saved.plan,
      },
    };
  }
  const { row } = saved;

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

  return { ok: true, row, position: saved.position };
}
