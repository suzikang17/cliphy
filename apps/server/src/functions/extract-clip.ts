import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { extractWebClip } from "../services/extractors/web.js";
import { extractTweetClip } from "../services/extractors/tweet.js";

const log = logger.child({ fn: "extract-clip" });

// Fetching a saved article or post, after the save has already answered.
//
// POST /clips stores the bare link (status "processing", the address as its
// title) and returns at once; this reads the page and fills the clip in.
// The summary, tags and category follow in embed-clip, which already reads
// any web or tweet clip that arrives without them.

/** What reading the page adds to the clip's row. */
export async function extractedFields(
  sourceType: string,
  url: string,
): Promise<Record<string, unknown>> {
  if (sourceType === "tweet") {
    const tw = await extractTweetClip(url);
    return {
      video_title: `${tw.author.name} (@${tw.author.handle})`,
      author: tw.author.handle,
      content: tw.text,
      excerpt: tw.text.slice(0, 200),
      hero_image_url: tw.heroImageUrl ?? null,
      published_at: tw.publishedAt ?? null,
      source_metadata: {
        handle: tw.author.handle,
        avatarUrl: tw.author.avatarUrl,
        media: tw.media,
        quotedTweet: tw.quotedTweet,
        threadTweetIds: tw.threadTweetIds,
        threadTruncated: tw.threadTruncated,
        likeCount: tw.likeCount,
        retweetCount: tw.retweetCount,
      },
    };
  }
  const web = await extractWebClip(url);
  return {
    video_title: web.title,
    content: web.content || null,
    excerpt: web.excerpt ?? null,
    hero_image_url: web.heroImageUrl ?? null,
    source_metadata: {
      siteName: web.siteName,
      faviconUrl: web.faviconUrl,
      readingTimeMin: web.readingTimeMin,
      kind: web.kind,
    },
  };
}

export const extractClip = inngest.createFunction(
  {
    id: "extract-clip",
    retries: 2,
    triggers: [{ event: "clip/extract.requested" }],
    // Every try failed: the clip stays, as the bare link, marked failed.
    onFailure: async ({ event }) => {
      const { clipId } = event.data.event.data as { clipId: string };
      await supabase
        .from("clips")
        .update({
          status: "failed",
          error_message: event.data.error.message || "Extraction failed",
        })
        .eq("id", clipId)
        .eq("status", "processing");
      log.warn("Extraction failed", { clipId, error: event.data.error.message });
    },
  },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    // Read and write in one step: an article's text is too much to pass
    // between steps, and a retry should read the page again anyway.
    const outcome = await step.run("extract", async () => {
      const { data, error } = await supabase
        .from("clips")
        .select("id, source_type, source_url, status")
        .eq("id", clipId)
        .single();
      if (error || !data) throw new Error(`Extract: clip ${clipId} not found: ${error?.message}`);
      const clip = data as { source_type: string; source_url: string | null; status: string };
      // Deleted and re-saved, or already filled in by an earlier delivery.
      if (clip.status !== "processing" || !clip.source_url) return "skipped";

      const fields = await extractedFields(clip.source_type, clip.source_url);
      const { error: writeError } = await supabase
        .from("clips")
        .update({ ...fields, status: "completed" })
        .eq("id", clipId)
        .eq("status", "processing");
      if (writeError) throw new Error(`Extract: failed to write ${clipId}: ${writeError.message}`);
      return "completed";
    });

    if (outcome === "completed") {
      await step.run("request-embed", async () => {
        await inngest.send({ name: "clip/embed.requested", data: { clipId } });
      });
    }

    log.info("Extract clip done", { clipId, outcome });
    return { clipId, status: outcome };
  },
);
