import type { EventPayload } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { parseFeedEpisodes } from "../services/rss.js";

const log = logger.child({ fn: "poll-podcast-feeds" });

// ─── Cron: fires every 6 hours, fans out one event per active feed ──────────

export const pollPodcastFeedsCron = inngest.createFunction(
  { id: "poll-podcast-feeds-cron", triggers: [{ cron: "0 */6 * * *" }] },
  async () => {
    const { data: feeds, error } = await supabase.from("podcast_feeds").select("id");

    if (error) {
      log.error(
        "Failed to fetch podcast feeds",
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }

    const rows = feeds ?? [];
    if (rows.length > 0) {
      await inngest.send(
        rows.map((feed) => ({
          name: "podcast/feed.poll" as const,
          data: { feedId: feed.id as string },
        })),
      );
    }

    log.info("Dispatched podcast feed poll events", { count: rows.length });
    return { dispatched: rows.length };
  },
);

// ─── Worker: process a single feed poll ─────────────────────────────────────

export const processPodcastFeedPoll = inngest.createFunction(
  {
    id: "process-podcast-feed-poll",
    retries: 2,
    triggers: [{ event: "podcast/feed.poll" }],
  },
  async ({
    event,
    step,
  }: {
    event: EventPayload & { data: { feedId: string; userId?: string } };
    step: {
      run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    };
  }) => {
    const { feedId } = event.data;

    // Step 1: Fetch feed record
    const feed = await step.run("fetch-feed", async () => {
      const { data, error } = await supabase
        .from("podcast_feeds")
        .select("id, user_id, rss_url, auto_queue, min_duration_seconds, max_duration_seconds")
        .eq("id", feedId)
        .single();

      if (error || !data) {
        throw new Error(`Podcast feed not found: ${feedId}`);
      }
      return data as {
        id: string;
        user_id: string;
        rss_url: string;
        auto_queue: boolean;
        min_duration_seconds: number | null;
        max_duration_seconds: number | null;
      };
    });

    // Step 2: Fetch episodes from RSS and persist new ones
    const summary = await step.run("process-episodes", async () => {
      let episodes;
      try {
        episodes = await parseFeedEpisodes(feed.rss_url);
      } catch (err) {
        log.error(
          `Failed to fetch RSS for feed ${feedId}`,
          err instanceof Error ? err : new Error(String(err)),
        );
        return { inserted: 0, skipped: 0, queued: 0 };
      }

      let inserted = 0;
      let skipped = 0;
      let queued = 0;
      const toTranscribe: string[] = [];

      for (const ep of episodes) {
        // Check whether this episode already exists for this user
        const { data: existing } = await supabase
          .from("podcast_episodes")
          .select("id")
          .eq("user_id", feed.user_id)
          .eq("guid", ep.guid)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Apply duration filters — episodes outside bounds are not stored at all.
        // Episodes with no duration metadata are skipped when any filter is active,
        // since we cannot verify they meet the configured constraints.
        {
          const min = feed.min_duration_seconds;
          const max = feed.max_duration_seconds;
          const hasFilter = min !== null || max !== null;
          if (ep.durationSeconds === undefined) {
            if (hasFilter) {
              skipped++;
              continue;
            }
          } else {
            if (min !== null && ep.durationSeconds < min) {
              skipped++;
              continue;
            }
            if (max !== null && ep.durationSeconds > max) {
              skipped++;
              continue;
            }
          }
        }

        const status = feed.auto_queue ? "queued" : "pending_approval";

        const { data: row, error: insertError } = await supabase
          .from("podcast_episodes")
          .insert({
            feed_id: feed.id,
            user_id: feed.user_id,
            guid: ep.guid,
            title: ep.title,
            description: ep.description ?? null,
            audio_url: ep.audioUrl,
            artwork_url: ep.artworkUrl ?? null,
            duration_seconds: ep.durationSeconds ?? null,
            published_at: ep.publishedAt,
            transcript_url: ep.transcriptUrl ?? null,
            status,
          })
          .select("id")
          .single();

        if (insertError) {
          // Concurrent insert (same guid) — treat as already existing
          if (insertError.code === "23505") {
            skipped++;
          } else {
            log.error(`Failed to insert episode ${ep.guid}`, new Error(insertError.message));
          }
          continue;
        }

        inserted++;

        if (status === "queued" && row) {
          queued++;
          toTranscribe.push(row.id as string);
        }
      }

      // Fire transcription events for all auto-queued episodes
      if (toTranscribe.length > 0) {
        await inngest.send(
          toTranscribe.map((episodeId) => ({
            name: "podcast/episode.transcribe" as const,
            data: { episodeId },
          })),
        );
      }

      return { inserted, skipped, queued };
    });

    // Step 3: Stamp last_polled_at
    await step.run("update-last-polled", async () => {
      await supabase
        .from("podcast_feeds")
        .update({ last_polled_at: new Date().toISOString() })
        .eq("id", feedId);
    });

    log.info("Feed poll complete", { feedId, ...summary });
    return { feedId, ...summary };
  },
);
