import type { Summary, TweetClipMetadata } from "@cliphy/shared";

/** Where the rest of a post is, when it was saved as only its opening. */
export function cutTweetLink(
  summary: Pick<Summary, "sourceType" | "sourceUrl" | "sourceMetadata">,
): string | null {
  if (summary.sourceType !== "tweet" || !summary.sourceUrl) return null;
  const meta = (summary.sourceMetadata ?? {}) as Partial<TweetClipMetadata>;
  return meta.threadTruncated ? summary.sourceUrl : null;
}
