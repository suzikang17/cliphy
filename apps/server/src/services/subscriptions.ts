import { PLAN_LIMITS } from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { fetchChannelVideos, fetchLikedVideos, fetchPlaylistVideos } from "./youtube.js";

const log = logger.child({ fn: "subscriptions" });

export async function snapshotSeenVideos(
  subscriptionId: string,
  videoIds: string[],
): Promise<void> {
  if (videoIds.length === 0) return;
  await supabase.from("subscription_seen_videos").insert(
    videoIds.map((youtube_video_id) => ({
      subscription_id: subscriptionId,
      youtube_video_id,
    })),
  );
}

export async function refreshGoogleTokenIfNeeded(userId: string): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("user_google_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (!tokenRow) return null;

  const expiresAt = new Date(tokenRow.expires_at as string).getTime();
  if (Date.now() < expiresAt - 60_000) return tokenRow.access_token as string;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token as string,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  });

  if (!res.ok) {
    log.warn("Google token refresh failed", { userId, status: res.status });
    return null;
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from("user_google_tokens")
    .update({ access_token: data.access_token, expires_at: newExpiresAt })
    .eq("user_id", userId);

  return data.access_token;
}

export async function pollAndQueueSubscription(subscriptionId: string): Promise<void> {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("*, users!inner(plan, monthly_limit_bonus)")
    .eq("id", subscriptionId)
    .single();

  if (!sub || !sub.is_active) return;

  const userId = sub.user_id as string;
  const type = sub.type as string;

  // liked and watch_later require a Google token; playlists use one when
  // available so private playlists work (falls back to the public API key)
  const needsToken = type === "watch_later" || type === "liked";
  let accessToken: string | null = null;
  if (needsToken || type === "playlist") {
    accessToken = await refreshGoogleTokenIfNeeded(userId);
    if (needsToken && !accessToken) {
      await supabase.from("subscriptions").update({ is_active: false }).eq("id", subscriptionId);
      log.warn("Deactivated subscription — token refresh failed", { subscriptionId, type });
      return;
    }
  }

  let videos;
  try {
    if (type === "channel") {
      videos = await fetchChannelVideos(sub.source_id as string);
    } else if (type === "liked") {
      videos = await fetchLikedVideos(accessToken as string);
    } else {
      const playlistId = type === "watch_later" ? "WL" : (sub.source_id as string);
      videos = await fetchPlaylistVideos(playlistId, accessToken ?? undefined);
    }
  } catch (err) {
    log.error(
      "Failed to fetch videos from YouTube",
      err instanceof Error ? err : new Error(String(err)),
      { subscriptionId },
    );
    throw err;
  }

  if (videos.length === 0) {
    await supabase
      .from("subscriptions")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", subscriptionId);
    return;
  }

  const videoIds = videos.map((v) => v.videoId);
  const { data: seenRows } = await supabase
    .from("subscription_seen_videos")
    .select("youtube_video_id")
    .eq("subscription_id", subscriptionId)
    .in("youtube_video_id", videoIds);

  const seenSet = new Set((seenRows ?? []).map((r) => r.youtube_video_id as string));
  const newVideos = videos.filter((v) => !seenSet.has(v.videoId));

  if (newVideos.length > 0) {
    // Mark all new videos as seen upfront — prevents retry-spam on rate limit
    await supabase.from("subscription_seen_videos").insert(
      newVideos.map((v) => ({
        subscription_id: subscriptionId,
        youtube_video_id: v.videoId,
      })),
    );
  }

  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select("summary_language")
    .eq("user_id", userId)
    .single();
  const summaryLanguage = (settingsRow?.summary_language as string) ?? "en";

  const subUser = (sub as Record<string, unknown>).users as {
    plan: string;
    monthly_limit_bonus?: number;
  } | null;
  const plan = subUser?.plan;
  const limit =
    PLAN_LIMITS[(plan as "free" | "pro") ?? "free"] + (subUser?.monthly_limit_bonus ?? 0);
  let skippedThisRun = 0;

  for (const video of newVideos) {
    const { data: allowed } = await supabase.rpc("increment_monthly_count", {
      p_user_id: userId,
      p_limit: limit,
    });

    if (!allowed) {
      skippedThisRun++;
      continue;
    }

    const { data: existing } = await supabase
      .from("summaries")
      .select("id")
      .eq("user_id", userId)
      .eq("youtube_video_id", video.videoId)
      .neq("status", "failed")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase.rpc("decrement_monthly_count", { p_user_id: userId });
      continue;
    }

    const { data: row, error: insertError } = await supabase
      .from("summaries")
      .insert({
        user_id: userId,
        youtube_video_id: video.videoId,
        video_title: video.title,
        video_channel: video.channelTitle ?? null,
        video_url: `https://www.youtube.com/watch?v=${video.videoId}`,
        summary_language: summaryLanguage,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !row) {
      await supabase.rpc("decrement_monthly_count", { p_user_id: userId });
      continue;
    }

    await inngest.send({
      name: "video/summarize.requested",
      data: {
        summaryId: row.id as string,
        videoId: video.videoId,
        videoTitle: video.title,
      },
    });

    log.info("Auto-queued video", { subscriptionId, videoId: video.videoId, userId });
  }

  const now = new Date().toISOString();
  if (skippedThisRun > 0) {
    await supabase
      .from("subscriptions")
      .update({
        last_checked_at: now,
        skipped_count: (sub.skipped_count as number) + skippedThisRun,
        last_skipped_at: now,
      })
      .eq("id", subscriptionId);
    log.info("Skipped videos due to rate limit", { subscriptionId, skippedThisRun });
  } else {
    await supabase.from("subscriptions").update({ last_checked_at: now }).eq("id", subscriptionId);
  }
}
