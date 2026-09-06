import { downloadImage } from "../lib/storage.js";
import { imageSize, tileImage } from "./tiling.js";
import { shouldTile, mergeTiles, analyzeImage, type VisionResult } from "./vision.js";
import { extractTweetClip } from "./extractors/tweet.js";

export interface ImageVisionResult {
  kind: "text" | "visual";
  content: string;
  excerpt: string;
  metadata: Record<string, unknown>;
}

// Read an uploaded image from storage and run Claude vision on it (tiling tall
// images when sharp is available). If a tweet URL is visible, re-fetch the real
// tweet. Returns the fields to persist on the clip. Used synchronously by the
// clips route so image capture doesn't depend on the async worker.
export async function runImageVision(storagePath: string): Promise<ImageVisionResult> {
  const { bytes, mediaType } = await downloadImage(storagePath);
  const { width, height } = await imageSize(bytes); // {0,0} when sharp is unavailable
  const tiles = shouldTile(width, height) ? await tileImage(bytes) : [bytes];

  const results: VisionResult[] = [];
  for (const tile of tiles) {
    try {
      results.push(await analyzeImage(tile, mediaType));
    } catch {
      results.push({ kind: "visual", extractedText: "", description: "", partial: true });
    }
  }
  const vision = mergeTiles(results);

  let tweet = vision.reconstructedTweet
    ? {
        handle: vision.reconstructedTweet.handle,
        author: vision.reconstructedTweet.author,
        text: vision.reconstructedTweet.text,
      }
    : undefined;
  if (vision.detectedTweetUrl) {
    try {
      const tw = await extractTweetClip(vision.detectedTweetUrl);
      tweet = { handle: tw.author.handle, author: tw.author.name, text: tw.text };
    } catch {
      // keep the reconstructed tweet (or none)
    }
  }

  const isText = vision.kind === "text" || Boolean(tweet);
  const content = tweet?.text || (isText ? vision.extractedText : vision.description);
  const excerpt = (content || vision.description).slice(0, 200);

  return {
    kind: isText ? "text" : "visual",
    content,
    excerpt,
    metadata: {
      kind: isText ? "text" : "visual",
      storagePath,
      width,
      height,
      tiled: shouldTile(width, height),
      partial: vision.partial,
      detectedTweetUrl: vision.detectedTweetUrl,
      tweet,
    },
  };
}
