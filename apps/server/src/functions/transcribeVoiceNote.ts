import { NonRetriableError } from "inngest";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { signImageUrl } from "../lib/storage.js";
import { titleFrom } from "../routes/notes.js";
import { checkTranscription, startTranscription } from "../services/transcribe.js";

const log = logger.child({ fn: "transcribe-voice-note" });

/** Failures that will be the same on a second try: nothing to hear, or nothing set up to listen. */
const FINAL = /No speech found|not set up|\b40[0-4]\b/;
/** How often a service of our own is asked whether it has finished, and how many times. */
const LOOK_EVERY = "5s";
const MAX_LOOKS = 120;

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

    /** Say why on the note and stop: trying again would fail the same way. */
    const giveUp = async (reason: string): Promise<never> => {
      await supabase
        .from("clips")
        .update({ status: "failed", error_message: reason })
        .eq("id", clipId);
      log.warn("Voice note could not be transcribed", { clipId, reason });
      throw new NonRetriableError(reason);
    };
    const attempt = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        const reason = err instanceof Error && err.message ? err.message : "Error";
        if (!FINAL.test(reason)) throw err;
        return giveUp(reason);
      }
    };

    // A hosted service answers here. One of our own takes the job and is
    // asked again below, so no single call has to outlast the function's limit.
    const started = await step.run("transcribe", () =>
      attempt(async () => {
        const url = await signImageUrl(path);
        if (!url) throw new Error("Recording not found in storage");
        return startTranscription(url);
      }),
    );

    let transcript = "done" in started ? started.done : null;
    if ("jobId" in started) {
      for (let look = 1; look <= MAX_LOOKS && !transcript; look++) {
        await step.sleep(`wait-${look}`, LOOK_EVERY);
        transcript = await step.run(`check-${look}`, () =>
          attempt(() => checkTranscription(started.jobId)),
        );
      }
    }
    if (!transcript) return giveUp("Transcription took too long");
    const result = transcript;

    await step.run("store", async () => {
      const { error } = await supabase
        .from("clips")
        .update({
          content: result.text,
          video_title: titleFrom(result.text),
          status: "completed",
          error_message: null,
          source_metadata: {
            ...clip.source_metadata,
            ...(result.seconds ? { seconds: result.seconds } : {}),
          },
        })
        .eq("id", clipId);
      if (error) throw new Error(`Failed to store transcript for ${clipId}: ${error.message}`);
    });

    // Tagged, summarized and made searchable by the same job as every clip.
    await step.run("request-embed", async () => {
      await inngest.send({ name: "clip/embed.requested", data: { clipId } });
    });
    return { clipId, seconds: result.seconds };
  },
);
