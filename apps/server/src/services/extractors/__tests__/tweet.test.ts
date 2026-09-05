import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { parseTweetId, mapSyndicationTweet } from "../tweet.js";

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
