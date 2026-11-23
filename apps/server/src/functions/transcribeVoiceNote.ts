import { NonRetriableError } from "inngest";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { signImageUrl } from "../lib/storage.js";
import { titleFrom } from "../routes/notes.js";
import { transcribeAudio } from "../services/transcribe.js";

const log = logger.child({ fn: "transcribe-voice-note" });

/** Failures that will be the same on a second try: nothing to hear, or nothing set up to listen. */
const FINAL = /No speech found|not set up|\b40[0-4]\b/;

/**
 * A voice note's recording becomes its words. The words go on the clip as
 * its content, and the clip is handed to the job that tags and indexes every
 * clip, so a voice note is filed like anything else that was saved.
 */
export const transcribeVoiceNote = inngest.createFunction(
  { id: "transcribe-voice-note", retries: 3, triggers: [{ event: "voice/note.transcribe" }] },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    const clip = await step.run("fetch-clip", async () => {
      const { data } = await supabase
        .from("clips")
        .select("id, user_id, source_type, status, source_metadata")
        .eq("id", clipId)
        .maybeSingle();
      return data as {
        id: string;
        source_type: string;
        status: string;
        source_metadata: { storagePath?: string } | null;
      } | null;
    });
    const path = clip?.source_metadata?.storagePath;
    if (!clip || clip.source_type !== "voice" || clip.status !== "processing" || !path) {
      return { skipped: true };
    }

    const transcript = await step.run("transcribe", async () => {
      try {
        const url = await signImageUrl(path);
        if (!url) throw new Error("Recording not found in storage");
        return await transcribeAudio(url);
      } catch (err) {
        const reason = err instanceof Error && err.message ? err.message : "Error";
        if (!FINAL.test(reason)) throw err;
        // Trying again would fail the same way: say why on the note and stop.
        await supabase
          .from("clips")
          .update({ status: "failed", error_message: reason })
          .eq("id", clipId);
        log.warn("Voice note could not be transcribed", { clipId, reason });
        throw new NonRetriableError(reason);
      }
    });

    await step.run("store", async () => {
      const { error } = await supabase
        .from("clips")
        .update({
          content: transcript.text,
          video_title: titleFrom(transcript.text),
          status: "completed",
          error_message: null,
          source_metadata: {
            ...clip.source_metadata,
            ...(transcript.seconds ? { seconds: transcript.seconds } : {}),
          },
        })
        .eq("id", clipId);
      if (error) throw new Error(`Failed to store transcript for ${clipId}: ${error.message}`);
    });

    // Tagged, summarized and made searchable by the same job as every clip.
    await step.run("request-embed", async () => {
      await inngest.send({ name: "clip/embed.requested", data: { clipId } });
    });
    return { clipId, seconds: transcript.seconds };
  },
);
