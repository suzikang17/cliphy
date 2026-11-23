import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { parseTweetId, mapSyndicationTweet, mapFxThread, extractTweetClip } from "../tweet.js";

const SYNDICATION_JSON = {
  id_str: "20",
  full_text: "just setting up my twttr",
  created_at: "2006-03-21T20:50:14.000Z",
  favorite_count: 100,
  user: {
    name: "jack",
    screen_name: "jack",
    profile_image_url_https: "https://pbs.test/jack.jpg",
  },
  mediaDetails: [{ type: "photo", media_url_https: "https://pbs.test/photo.jpg" }],
};

describe("tweet extractor", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Tweet Extraction");
  });

  it.each([
    ["https://x.com/jack/status/20", "20"],
    ["https://twitter.com/jack/status/20?s=46", "20"],
    ["https://example.com/not/a/tweet", null],
  ])("parses id from %s", (url, expected) => {
    expect(parseTweetId(url)).toBe(expected);
  });

  it("maps syndication JSON to a TweetClip", () => {
    const clip = mapSyndicationTweet(SYNDICATION_JSON);
    expect(clip.text).toBe("just setting up my twttr");
    expect(clip.author.handle).toBe("jack");
    expect(clip.author.avatarUrl).toBe("https://pbs.test/jack.jpg");
    expect(clip.media).toEqual([
      {
        type: "photo",
        url: "https://pbs.test/photo.jpg",
        previewUrl: "https://pbs.test/photo.jpg",
      },
    ]);
    expect(clip.heroImageUrl).toBe("https://pbs.test/photo.jpg");
    expect(clip.likeCount).toBe(100);
    expect(clip.threadTweetIds).toEqual(["20"]);
  });
});

// What the two sources really answer for a long post that opens a two-post
// thread (shapes as captured from both on 2026-11-23, cut down).
const LONG = "The opening of a long post. ".repeat(100).trim();
const EMBED_LONG = {
  id_str: "111",
  text: LONG.slice(0, 276),
  note_tweet: { id: "Tm90ZVR3ZWV0" },
  conversation_count: 4321, // replies, not thread length
  favorite_count: 9,
  user: { name: "Pat", screen_name: "pat", profile_image_url_https: "https://pbs.test/pat.jpg" },
  mediaDetails: [{ type: "photo", media_url_https: "https://pbs.test/chart.jpg" }],
};
const FX_THREAD = {
  code: 200,
  status: { id: "111", text: LONG, author: { name: "Pat", screen_name: "pat" }, likes: 9 },
  thread: [
    {
      id: "111",
      text: LONG,
      author: { name: "Pat", screen_name: "pat" },
      media: { photos: [{ url: "https://pbs.test/chart.jpg" }] },
    },
    { id: "112", text: "And one more thing.", author: { name: "Pat", screen_name: "pat" } },
  ],
};

describe("reading a post from both sources", () => {
  let embed: unknown;
  let fx: unknown;

  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Tweet Extraction");
    embed = EMBED_LONG;
    fx = FX_THREAD;
    vi.stubGlobal("fetch", async (input: string) => {
      const answer = String(input).includes("syndication") ? embed : fx;
      return answer ? Response.json(answer) : new Response("no", { status: 500 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("marks a long post from the embed endpoint as cut, whatever its reply count", () => {
    expect(mapSyndicationTweet(EMBED_LONG).threadTruncated).toBe(true);
    expect(mapSyndicationTweet({ ...SYNDICATION_JSON, conversation_count: 19260 })).toMatchObject({
      threadTruncated: false,
    });
  });

  it("joins the author's thread, oldest first", () => {
    const clip = mapFxThread(FX_THREAD, "111");
    expect(clip?.text).toBe(`${LONG}\n\nAnd one more thing.`);
    expect(clip?.threadTweetIds).toEqual(["111", "112"]);
  });

  it("saves the whole long post and its thread, with who and what from X", async () => {
    const clip = await extractTweetClip("https://x.com/pat/status/111");
    expect(clip.text).toBe(`${LONG}\n\nAnd one more thing.`);
    expect(clip.text.length).toBeGreaterThan(2000);
    expect(clip.threadTweetIds).toEqual(["111", "112"]);
    expect(clip.threadTruncated).toBe(false);
    expect(clip.author).toEqual({
      name: "Pat",
      handle: "pat",
      avatarUrl: "https://pbs.test/pat.jpg",
    });
    expect(clip.heroImageUrl).toBe("https://pbs.test/chart.jpg");
  });

  it("falls back to the opening, marked as cut, when FxTwitter is down", async () => {
    fx = null;
    const clip = await extractTweetClip("https://x.com/pat/status/111");
    expect(clip.text).toHaveLength(276);
    expect(clip.threadTruncated).toBe(true);
  });

  it("uses FxTwitter alone when X's embed endpoint is down", async () => {
    embed = null;
    const clip = await extractTweetClip("https://x.com/pat/status/111");
    expect(clip.text.startsWith(LONG)).toBe(true);
    expect(clip.author.handle).toBe("pat");
  });

  it("fails when neither answers", async () => {
    embed = null;
    fx = null;
    await expect(extractTweetClip("https://x.com/pat/status/111")).rejects.toThrow(/111/);
  });
});
