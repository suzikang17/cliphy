import type { Summary, TweetClipMetadata } from "@cliphy/shared";

/** Where the rest of a post is, when it was saved as only its opening. */
export function cutTweetLink(
  summary: Pick<Summary, "sourceType" | "sourceUrl" | "sourceMetadata">,
): string | null {
  if (summary.sourceType !== "tweet" || !summary.sourceUrl) return null;
  const meta = (summary.sourceMetadata ?? {}) as Partial<TweetClipMetadata>;
  return meta.threadTruncated ? summary.sourceUrl : null;
}

/**
 * The picture to show for a post: its first photo, or the still of its first
 * video or GIF. A photo can arrive with only `url` (one of the two readers
 * gives no preview for photos); a video's `url` is the clip itself, never an
 * image, so only its `previewUrl` counts.
 */
export function tweetImage(
  summary: Pick<Summary, "sourceType" | "sourceMetadata" | "heroImageUrl">,
): string | null {
  if (summary.sourceType !== "tweet") return null;
  const first = ((summary.sourceMetadata ?? {}) as Partial<TweetClipMetadata>).media?.[0];
  if (first) return first.previewUrl ?? (first.type === "photo" ? first.url : null) ?? null;
  return summary.heroImageUrl ?? null;
}
