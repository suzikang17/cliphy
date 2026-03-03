import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { NonRetriableError } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { fetchTranscript, TranscriptNotAvailableError } from "../services/transcript.js";
import { summarizeTranscript } from "../services/summarizer.js";

const log = logger.child({ fn: "summarize-video" });

export const summarizeVideo = inngest.createFunction(
  {
    id: "summarize-video",
    onFailure: async ({ event }) => {
      const { summaryId } = event.data.event.data as { summaryId: string };
      const errorMessage = event.data.error.message || "Failed to generate summary";
      await supabase
        .from("summaries")
        .update({ status: "failed", error_message: errorMessage })
        .eq("id", summaryId);
    },
  },
  { event: "video/summarize.requested" },
  async ({ event, step }) => {
    const { summaryId, videoId, videoTitle } = event.data as {
      summaryId: string;
      videoId: string;
      videoTitle: string;
    };

    // Step 1: Mark as processing and fetch transcript server-side
    const { text: transcript, truncated } = await step.run("fetch-transcript", async () => {
      await supabase.from("summaries").update({ status: "processing" }).eq("id", summaryId);

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
        .update({ status: "completed", summary_json: summaryJson })
        .eq("id", summaryId);
    });

    return { summaryId, status: "completed" };
  },
);
