import { describe, it, expect } from "vitest";
import { refetchedTweetPatch, unreadableTweetPatch } from "../refetchTweet.js";
import type { TweetClip } from "../extractors/tweet.js";

// Tweets saved before long posts were read in full hold only the opening,
// and most carry a wrong "cut" mark. This decides what a fresh read changes.

const LONG = "A long post that goes on. ".repeat(60).trim();
const fresh = (over: Partial<TweetClip> = {}): TweetClip => ({
  text: LONG,
  author: { name: "Pat", handle: "pat" },
  media: [],
  quotedTweet: null,
  threadTweetIds: ["111"],
  threadTruncated: false,
  ...over,
});
const meta = { handle: "pat", threadTweetIds: ["111"], threadTruncated: true, likeCount: 4 };

describe("refetchedTweetPatch", () => {
  it("fills in a post that was saved as its opening, and clears the cut mark", () => {
    const stored = { content: `${LONG.slice(0, 270)} https://t.co/abc`, source_metadata: meta };
    const patch = refetchedTweetPatch(stored, fresh({ threadTweetIds: ["111", "112"] }));
    expect(patch?.content).toBe(LONG);
    expect(patch?.source_metadata).toEqual({
      ...meta,
      threadTruncated: false,
      threadTweetIds: ["111", "112"],
    });
  });

  it("only clears a wrong cut mark on a short post that was saved whole", () => {
    const stored = { content: "just setting up my twttr", source_metadata: meta };
    expect(refetchedTweetPatch(stored, fresh({ text: "just setting up my twttr" }))).toEqual({
      source_metadata: { ...meta, threadTruncated: false },
    });
  });

  it("changes nothing on a clip that is already whole and unmarked", () => {
    const stored = { content: LONG, source_metadata: { ...meta, threadTruncated: false } };
    expect(refetchedTweetPatch(stored, fresh())).toBeNull();
  });

  it("never replaces saved words with a post that reads differently", () => {
    const stored = { content: "What I saved back then.", source_metadata: meta };
    const patch = refetchedTweetPatch(
      stored,
      fresh({ text: "Edited into something else. ".repeat(20) }),
    );
    expect(patch?.content).toBeUndefined();
    // Nothing was learned about the saved words, so the mark stays as it was.
    expect(patch).toBeNull();
  });

  it("never shortens what was saved", () => {
    const stored = { content: LONG, source_metadata: { ...meta, threadTruncated: false } };
    expect(refetchedTweetPatch(stored, fresh({ text: LONG.slice(0, 100) }))).toBeNull();
  });

  it("keeps the mark when the fresh read is itself cut", () => {
    const opening = LONG.slice(0, 270);
    const stored = { content: opening, source_metadata: meta };
    expect(refetchedTweetPatch(stored, fresh({ text: opening, threadTruncated: true }))).toBeNull();
  });
});

describe("unreadableTweetPatch", () => {
  it("clears a cut mark that cannot be true on a short post", () => {
    expect(unreadableTweetPatch({ content: "short one", source_metadata: meta })).toEqual({
      source_metadata: { ...meta, threadTruncated: false },
    });
  });

  it("leaves a long-enough post alone: it may really be cut", () => {
    expect(unreadableTweetPatch({ content: LONG.slice(0, 270), source_metadata: meta })).toBeNull();
  });
});
