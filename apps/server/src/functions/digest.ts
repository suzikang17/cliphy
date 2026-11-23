import { SUMMARY_LANGUAGES } from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { DIGEST_SIZE, MAX_ATTEMPTS, findCandidates, scoreCandidates } from "../services/digest.js";
import { sendPush } from "../services/push.js";
import { summarizeTranscript } from "../services/summarizer.js";
import { TranscriptNotAvailableError, fetchTranscript } from "../services/transcript.js";

const log = logger.child({ fn: "digest" });

// Cron: Sundays 15:00 UTC, one event per person who turned the digest on.
export const weeklyDigestCron = inngest.createFunction(
  { id: "weekly-digest-cron", triggers: [{ cron: "0 15 * * 0" }] },
  async () => {
    const { data, error } = await supabase
      .from("user_settings")
      .select("user_id")
      .eq("weekly_digest", true);
    if (error) throw new Error(`Could not list digest users: ${error.message}`);
    const users = data ?? [];
    if (users.length > 0) {
      await inngest.send(
        users.map((u) => ({
          name: "digest/build.requested" as const,
          data: { userId: u.user_id as string },
        })),
      );
    }
    log.info("Dispatched weekly digests", { count: users.length });
    return { dispatched: users.length };
  },
);

// Worker: builds one person's digest. Also sent when they turn the digest on.
export const buildDigest = inngest.createFunction(
  {
    id: "build-digest",
    retries: 2,
    // One build per person at a time, so a double tap cannot make two digests.
    concurrency: [{ key: "event.data.userId", limit: 1 }],
    triggers: [{ event: "digest/build.requested" }],
  },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string };

    const enabled = await step.run("check-enabled", async () => {
      const { data } = await supabase
        .from("user_settings")
        .select("weekly_digest, summary_language")
        .eq("user_id", userId)
        .maybeSingle();
      return data?.weekly_digest === true
        ? { language: (data.summary_language as string | null) ?? "en" }
        : null;
    });
    if (!enabled) return { userId, items: 0, reason: "digest is off" };

    const candidates = await step.run("find-candidates", () => findCandidates(userId));
    if (candidates.length === 0) return { userId, items: 0, reason: "no new uploads" };

    const scored = await step.run("score", () => scoreCandidates(userId, candidates));

    const languageName =
      SUMMARY_LANGUAGES[enabled.language as keyof typeof SUMMARY_LANGUAGES] ?? "English";
    const digestDate = await step.run("date", async () => new Date().toISOString().slice(0, 10));

    let made = 0;
    for (const pick of scored.slice(0, MAX_ATTEMPTS)) {
      if (made >= DIGEST_SIZE) break;

      const transcript = await step.run(`transcript-${pick.videoId}`, async () => {
        try {
          const t = await fetchTranscript(pick.videoId);
          return { text: t.text, truncated: t.truncated, title: t.title, language: t.language };
        } catch (err) {
          // No captions (or a live stream): skip it and try the next closest.
          if (err instanceof TranscriptNotAvailableError) return null;
          throw err;
        }
      });
      if (!transcript) continue;

      await step.run(`summary-${pick.videoId}`, async () => {
        const spoken =
          SUMMARY_LANGUAGES[transcript.language as keyof typeof SUMMARY_LANGUAGES] ??
          (transcript.language || undefined);
        const summary = await summarizeTranscript(
          transcript.text,
          transcript.title || pick.title,
          languageName,
          spoken,
        );
        if (transcript.truncated) summary.truncated = true;
        const { error } = await supabase.from("digest_items").upsert(
          {
            user_id: userId,
            digest_date: digestDate,
            youtube_video_id: pick.videoId,
            video_title: transcript.title || pick.title,
            video_channel: pick.channelTitle || null,
            published_at: pick.publishedAt,
            score: pick.score,
            because_clip_id: pick.becauseClipId,
            summary_json: summary,
          },
          { onConflict: "user_id,youtube_video_id", ignoreDuplicates: true },
        );
        if (error) throw new Error(`Could not save digest item: ${error.message}`);
      });
      made++;
    }

    if (made > 0) {
      await step.run("notify", () =>
        sendPush(userId, {
          title: "Your weekly digest",
          body: `${made} new video${made === 1 ? "" : "s"} from channels you save from, summarized.`,
          data: { type: "video_digest" },
        }),
      );
    }

    log.info("Built digest", { userId, candidates: candidates.length, items: made });
    return { userId, candidates: candidates.length, items: made };
  },
);
