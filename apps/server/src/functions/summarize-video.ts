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

    // Step 1: Mark as processing, read transcript from DB (or fetch as fallback)
    const transcript = await step.run("fetch-transcript", async () => {
      await supabase.from("summaries").update({ status: "processing" }).eq("id", summaryId);

      // Check if transcript was stored by the extension
      const { data: row } = await supabase
        .from("summaries")
        .select("transcript")
        .eq("id", summaryId)
        .single();

      if (row?.transcript) {
        return row.transcript as string;
      }

      // Fallback: fetch server-side (may fail from datacenter IPs)
      try {
        return await fetchTranscript(videoId);
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
      return await summarizeTranscript(transcript, videoTitle || "Untitled Video");
    });

    // Step 3: Save result and clear stored transcript (no longer needed)
    await step.run("save-result", async () => {
      await supabase
        .from("summaries")
        .update({ status: "completed", summary_json: summaryJson, transcript: null })
        .eq("id", summaryId);
    });

    return { summaryId, status: "completed" };
  },
);
