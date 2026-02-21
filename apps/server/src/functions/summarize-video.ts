import { NonRetriableError } from "inngest";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { fetchTranscript, TranscriptNotAvailableError } from "../services/transcript.js";
import { summarizeTranscript } from "../services/summarizer.js";

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

    // Step 1: Mark as processing and fetch transcript
    const transcript = await step.run("fetch-transcript", async () => {
      await supabase.from("summaries").update({ status: "processing" }).eq("id", summaryId);

      try {
        return await fetchTranscript(videoId);
      } catch (err) {
        if (err instanceof TranscriptNotAvailableError) {
          // Mark as failed immediately — no point retrying
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
      return await summarizeTranscript(transcript, videoTitle || "Untitled Video");
    });

    // Step 3: Save result to DB
    await step.run("save-result", async () => {
      await supabase
        .from("summaries")
        .update({ status: "completed", summary_json: summaryJson })
        .eq("id", summaryId);
    });

    return { summaryId, status: "completed" };
  },
);
