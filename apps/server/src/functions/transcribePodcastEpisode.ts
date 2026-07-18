import type { EventPayload } from "inngest";
import { NonRetriableError } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { fetchTranscript } from "../services/rss.js";

const log = logger.child({ fn: "transcribe-podcast-episode" });

const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL ?? "";
const WHISPER_API_KEY = process.env.WHISPER_API_KEY ?? "";

export const transcribePodcastEpisode = inngest.createFunction(
  {
    id: "transcribe-podcast-episode",
    retries: 2,
    triggers: [{ event: "podcast/episode.transcribe" }],
  },
  async ({
    event,
    step,
  }: {
    event: EventPayload & { data: { episodeId: string } };
    step: {
      run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    };
  }) => {
    const { episodeId } = event.data;

    // Step 1: Fetch episode and parent feed
    const { episode, feed } = await step.run("fetch-episode", async () => {
      const { data: ep, error: epErr } = await supabase
        .from("podcast_episodes")
        .select(
          "id, feed_id, user_id, guid, title, audio_url, published_at, transcript_url, status",
        )
        .eq("id", episodeId)
        .single();

      if (epErr || !ep) {
        throw new NonRetriableError(`Podcast episode not found: ${episodeId}`);
      }

      const { data: fd, error: fdErr } = await supabase
        .from("podcast_feeds")
        .select("id, title")
        .eq("id", ep.feed_id as string)
        .single();

      if (fdErr || !fd) {
        throw new NonRetriableError(`Parent feed not found for episode: ${episodeId}`);
      }

      return {
        episode: ep as {
          id: string;
          feed_id: string;
          user_id: string;
          guid: string;
          title: string;
          audio_url: string;
          published_at: string;
          transcript_url: string | null;
          status: string;
        },
        feed: fd as { id: string; title: string },
      };
    });

    // Step 2: Mark as processing
    await step.run("mark-processing", async () => {
      await supabase.from("podcast_episodes").update({ status: "processing" }).eq("id", episodeId);
    });

    // Step 3: Obtain transcript — RSS-provided transcript URL first, then Whisper
    const transcript = await step.run("get-transcript", async () => {
      // Try RSS-provided transcript (Podcast 2.0 namespace)
      if (episode.transcript_url) {
        const text = await fetchTranscript(episode.transcript_url);
        if (text) {
          log.info("Transcript obtained from RSS", { episodeId });
          return text;
        }
      }

      // Fall back to VPS Whisper transcription service
      if (!WHISPER_SERVICE_URL) {
        await supabase.from("podcast_episodes").update({ status: "failed" }).eq("id", episodeId);
        throw new NonRetriableError(
          "No transcript available and WHISPER_SERVICE_URL is not configured",
        );
      }

      const controller = new AbortController();
      // 30-minute timeout for long episodes
      const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);

      let whisperRes: Response;
      try {
        whisperRes = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": WHISPER_API_KEY,
          },
          body: JSON.stringify({ audio_url: episode.audio_url }),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        throw new Error(`Whisper service unreachable: ${(err as Error).message}`, { cause: err });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!whisperRes.ok) {
        const body = await whisperRes.text().catch(() => "");
        throw new Error(`Whisper service error ${whisperRes.status}: ${body}`);
      }

      const data = (await whisperRes.json()) as { transcript?: string; text?: string };
      const text = data.transcript ?? data.text ?? "";

      if (!text) {
        await supabase.from("podcast_episodes").update({ status: "failed" }).eq("id", episodeId);
        throw new NonRetriableError("Whisper returned an empty transcript");
      }

      log.info("Transcript obtained from Whisper", { episodeId });
      return text;
    });

    // Step 4: Create a clip and hand off to the existing summarization pipeline
    const clipId = await step.run("create-clip", async () => {
      const { data: clip, error } = await supabase
        .from("clips")
        .insert({
          user_id: episode.user_id,
          source_type: "podcast",
          source_url: episode.audio_url,
          video_title: episode.title,
          author: feed.title,
          transcript,
          published_at: episode.published_at,
          status: "pending",
          tags: [],
        })
        .select("id")
        .single();

      if (error || !clip) {
        throw new Error(`Failed to create clip for episode ${episodeId}: ${error?.message}`);
      }

      return clip.id as string;
    });

    // Step 5: Fire the existing summarization event
    await step.run("request-summary", async () => {
      await inngest.send({
        name: "video/summarize.requested",
        data: {
          summaryId: clipId,
          videoId: "",
          videoTitle: episode.title,
          userId: episode.user_id,
        },
      });
    });

    // Step 6: Mark episode as done and link to the clip
    await step.run("mark-done", async () => {
      await supabase
        .from("podcast_episodes")
        .update({ status: "done", clip_id: clipId })
        .eq("id", episodeId);
    });

    log.info("Episode transcription complete", { episodeId, clipId });
    return { episodeId, clipId, status: "done" };
  },
);
