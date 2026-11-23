import type { TweetClip } from "./extractors/tweet.js";

// Re-reading tweets saved before long posts and threads were read in full
// (ADR 0071): what to change on a stored clip, given a fresh read of the post.

export interface StoredTweet {
  content: string | null;
  source_metadata: Record<string, unknown> | null;
}

export interface TweetPatch {
  content?: string;
  source_metadata?: Record<string, unknown>;
}

/** Text compared loosely: spacing and the t.co links X appends differ between reads. */
const loose = (text: string): string =>
  text
    .replace(/https?:\/\/t\.co\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** X's embed endpoint cuts a long post at about 280 characters; shorter text is whole. */
const CUT_AT_LEAST = 250;

/**
 * The change to make, or null when the clip is already right.
 *
 * - The words are replaced only when the fresh read is longer and begins the
 *   way the stored text does, so an edited or different post never overwrites
 *   what was saved.
 * - The "cut" mark is set from the fresh read. It used to be set from the
 *   reply count, so it is wrong on most older clips.
 */
export function refetchedTweetPatch(stored: StoredTweet, fresh: TweetClip): TweetPatch | null {
  const patch: TweetPatch = {};
  const was = stored.content ?? "";
  const opening = loose(was).slice(0, 120);
  const longer = fresh.text.length > was.length;
  if (longer && loose(fresh.text).startsWith(opening)) patch.content = fresh.text;

  const meta = stored.source_metadata ?? {};
  const wholeNow = patch.content !== undefined || loose(fresh.text) === loose(was);
  const next: Record<string, unknown> = {
    ...meta,
    // Still cut only if the fresh read says so and we did not get more.
    threadTruncated: wholeNow ? fresh.threadTruncated : Boolean(meta.threadTruncated),
  };
  if (patch.content !== undefined && fresh.threadTweetIds.length > 0) {
    next.threadTweetIds = fresh.threadTweetIds;
  }
  if (JSON.stringify(next) !== JSON.stringify(meta)) patch.source_metadata = next;

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * For a post that can no longer be read (deleted, protected): clear a "cut"
 * mark that cannot be true, because the stored text is too short to have been cut.
 */
export function unreadableTweetPatch(stored: StoredTweet): TweetPatch | null {
  const meta = stored.source_metadata ?? {};
  if (!meta.threadTruncated || (stored.content ?? "").length >= CUT_AT_LEAST) return null;
  return { source_metadata: { ...meta, threadTruncated: false } };
}
