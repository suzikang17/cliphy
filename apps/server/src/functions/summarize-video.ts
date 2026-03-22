import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { NonRetriableError } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { Sentry } from "../lib/sentry.js";
import { supabase } from "../lib/supabase.js";
import { fetchTranscript, TranscriptNotAvailableError } from "../services/transcript.js";
import { summarizeTranscript } from "../services/summarizer.js";

const log = logger.child({ fn: "summarize-video" });

function classifyError(message: string): string {
  if (/credit.?balance|billing|insufficient.?funds/i.test(message)) return "billing";
  if (/rate.?limit|429/i.test(message)) return "rate_limit";
  if (/timeout|ECONNREFUSED|connection/i.test(message)) return "network";
  if (/parse|json/i.test(message)) return "parse_failure";
  if (/500|503|overloaded|internal/i.test(message)) return "upstream";
  return "unknown";
}

export const summarizeVideo = inngest.createFunction(
  {
    id: "summarize-video",
    retries: 3,
    timeouts: { finish: "5m" },
    onFailure: async ({ event }) => {
      const { summaryId } = event.data.event.data as { summaryId: string };
      const videoId = (event.data.event.data as { videoId?: string }).videoId;
      const errorMessage = event.data.error.message || "Failed to generate summary";

      // Classify errors for Sentry grouping
      const isExpected = /no captions|transcript.*not available|subtitles.*disabled/i.test(
        errorMessage,
      );

      const errorCategory = classifyError(errorMessage);

      if (errorCategory === "billing") {
        // P0: AI service is down for all users
        Sentry.captureException(new Error(errorMessage), {
          level: "fatal",
          extra: { summaryId },
          tags: {
            component: "inngest",
            error_category: "billing",
            severity: "p0",
            video_id: videoId,
          },
          fingerprint: ["summarize-video", "billing"],
        });
      } else if (isExpected) {
        // Track expected failures without alerting
        Sentry.captureException(new Error(`No captions: ${videoId}`), {
          level: "warning",
          extra: { summaryId, errorMessage },
          tags: { component: "inngest", error_category: "no_captions", video_id: videoId },
          fingerprint: ["summarize-video", "no_captions"],
        });
      } else {
        Sentry.captureException(new Error(errorMessage), {
          extra: { summaryId },
          tags: {
            component: "inngest",
            error_category: errorCategory,
            video_id: videoId,
          },
          fingerprint: ["summarize-video", errorCategory],
        });
      }
      await Sentry.flush(2000);

      // Look up user_id from the summary row to rollback usage count
      const { data: summary } = await supabase
        .from("summaries")
        .select("user_id")
        .eq("id", summaryId)
        .single();

      await supabase
        .from("summaries")
        .update({ status: "failed", error_message: errorMessage })
        .eq("id", summaryId);

      // Rollback usage count — failed summaries shouldn't count against the user
      if (summary?.user_id) {
        await supabase.rpc("decrement_monthly_count", { p_user_id: summary.user_id });
      }
    },
  },
  { event: "video/summarize.requested" },
  async ({ event, step }) => {
    const { summaryId, videoId, videoTitle } = event.data as {
      summaryId: string;
      videoId: string;
      videoTitle: string;
    };

    // Step 1: Mark as processing and fetch transcript (use cached if available)
    const { text: transcript, truncated } = await step.run("fetch-transcript", async () => {
      await supabase.from("summaries").update({ status: "processing" }).eq("id", summaryId);

      // Check for a cached transcript from a previous summary of the same video
      const { data: cached } = await supabase
        .from("summaries")
        .select("transcript")
        .eq("video_id", videoId)
        .not("transcript", "is", null)
        .neq("id", summaryId)
        .limit(1)
        .single();

      if (cached?.transcript) {
        const text = cached.transcript as string;
        const wasTruncated = text.length >= MAX_TRANSCRIPT_LENGTH;
        log.info("Transcript cache hit", { videoId, chars: text.length });
        return { text, truncated: wasTruncated };
      }

      try {
        const result = await fetchTranscript(videoId);
        log.info("Transcript fetched", {
          videoId,
          chars: result.text.length,
          truncated: result.truncated,
        });
        return result;
      } catch (err) {
        if (err instanceof TranscriptNotAvailableError) {
          await supabase
            .from("summaries")
            .update({ status: "failed", error_message: err.message })
            .eq("id", summaryId);
          throw new NonRetriableError(err.message);
        }
        throw err;
      }
    });

    // Step 2: Generate summary via Claude
    const summaryJson = await step.run("generate-summary", async () => {
      try {
        const result = await summarizeTranscript(transcript, videoTitle || "Untitled Video");
        if (truncated) {
          result.truncated = true;
        }
        return result;
      } catch (err) {
        // Transient Anthropic errors — let Inngest retry with backoff
        if (err instanceof APIConnectionError) {
          throw err;
        }
        if (
          err instanceof APIError &&
          (err.status === 429 || err.status === 500 || err.status === 503)
        ) {
          throw err;
        }
        // Billing / auth errors from Anthropic — non-retryable
        if (err instanceof APIError && (err.status === 400 || err.status === 401)) {
          throw new NonRetriableError(
            "AI service temporarily unavailable. Please try again later.",
          );
        }
        // JSON parse failures from our parser — non-retryable
        if (err instanceof Error && err.message.startsWith("Failed to parse summary")) {
          throw new NonRetriableError("Failed to generate summary. Please try again.");
        }
        // Unknown errors — let Inngest retry
        throw err;
      }
    });

    // Step 3: Save result
    await step.run("save-result", async () => {
      await supabase
        .from("summaries")
        .update({ status: "completed", summary_json: summaryJson, transcript })
        .eq("id", summaryId);
    });

    return { summaryId, status: "completed" };
  },
);
