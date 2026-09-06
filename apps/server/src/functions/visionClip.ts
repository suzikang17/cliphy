import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { downloadImage } from "../lib/storage.js";
import { imageSize, tileImage } from "../services/tiling.js";
import { shouldTile, mergeTiles, analyzeImage, type VisionResult } from "../services/vision.js";
import { extractTweetClip } from "../services/extractors/tweet.js";

const log = logger.child({ fn: "vision-clip" });

export const visionClip = inngest.createFunction(
  { id: "vision-clip", retries: 2, triggers: [{ event: "clip/vision.requested" }] },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    const clip = await step.run("fetch-clip", async () => {
      const { data, error } = await supabase
        .from("clips")
        .select("id, user_id, hero_image_url, source_metadata")
        .eq("id", clipId)
        .single();
      if (error || !data) throw new Error(`Vision: clip ${clipId} not found: ${error?.message}`);
      return data as {
        id: string;
        user_id: string;
        hero_image_url: string;
        source_metadata: { storagePath?: string } | null;
      };
    });

    const storagePath = clip.source_metadata?.storagePath ?? clip.hero_image_url;

    const vision = await step.run(
      "analyze",
      async (): Promise<VisionResult & { width: number; height: number }> => {
        try {
          const { bytes, mediaType } = await downloadImage(storagePath);
          const { width, height } = await imageSize(bytes);
          const tiles = shouldTile(width, height) ? await tileImage(bytes) : [bytes];
          const results: VisionResult[] = [];
          for (const tile of tiles) {
            try {
              results.push(await analyzeImage(tile, mediaType));
            } catch {
              results.push({ kind: "visual", extractedText: "", description: "", partial: true });
            }
          }
          return { ...mergeTiles(results), width, height };
        } catch (err) {
          throw new Error(`Vision analysis failed for ${clipId}: ${(err as Error).message}`, {
            cause: err,
          });
        }
      },
    );

    // If a real tweet URL is visible, prefer the full-fidelity extractor.
    let tweet = vision.reconstructedTweet
      ? {
          handle: vision.reconstructedTweet.handle,
          author: vision.reconstructedTweet.author,
          text: vision.reconstructedTweet.text,
        }
      : undefined;
    if (vision.detectedTweetUrl) {
      const fetched = await step.run("refetch-tweet", async () => {
        try {
          const tw = await extractTweetClip(vision.detectedTweetUrl!);
          return { handle: tw.author.handle, author: tw.author.name, text: tw.text };
        } catch {
          return null;
        }
      });
      if (fetched) tweet = fetched;
    }

    await step.run("write-result", async () => {
      const isText = vision.kind === "text" || Boolean(tweet);
      const content = tweet?.text || (isText ? vision.extractedText : vision.description);
      const excerpt = (content || vision.description).slice(0, 200);
      const { error } = await supabase
        .from("clips")
        .update({
          content: content || null,
          excerpt: excerpt || null,
          status: "completed",
          source_metadata: {
            ...(clip.source_metadata ?? {}),
            kind: isText ? "text" : "visual",
            storagePath,
            width: vision.width,
            height: vision.height,
            tiled: shouldTile(vision.width, vision.height),
            partial: vision.partial,
            detectedTweetUrl: vision.detectedTweetUrl,
            tweet,
          },
        })
        .eq("id", clipId);
      if (error) throw new Error(`Failed to write vision result for ${clipId}: ${error.message}`);
    });

    await step.run("request-embed", async () => {
      await inngest.send({ name: "clip/embed.requested", data: { clipId } });
    });

    log.info("Vision clip complete", { clipId });
    return { clipId, status: "completed" };
  },
);
