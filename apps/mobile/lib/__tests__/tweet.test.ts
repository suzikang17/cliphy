import { describe, it, expect } from "vitest";
import { cutTweetLink, tweetImage } from "../tweet";

// "Continues on X" shows only for a post saved as its opening.

const URL = "https://x.com/pat/status/111";

describe("cutTweetLink", () => {
  it("links to the post when it was saved cut", () => {
    expect(
      cutTweetLink({
        sourceType: "tweet",
        sourceUrl: URL,
        sourceMetadata: { handle: "pat", threadTruncated: true },
      }),
    ).toBe(URL);
  });

  it("shows nothing for a post saved whole, or with no mark", () => {
    const base = { sourceType: "tweet" as const, sourceUrl: URL };
    expect(cutTweetLink({ ...base, sourceMetadata: { threadTruncated: false } })).toBeNull();
    expect(cutTweetLink({ ...base, sourceMetadata: undefined })).toBeNull();
  });

  it("shows nothing for anything that is not a post", () => {
    expect(
      cutTweetLink({
        sourceType: "web",
        sourceUrl: URL,
        sourceMetadata: { threadTruncated: true },
      }),
    ).toBeNull();
  });
});

describe("tweetImage", () => {
  const post = (media: unknown, heroImageUrl?: string) => ({
    sourceType: "tweet" as const,
    sourceMetadata: { handle: "pat", media } as Record<string, unknown>,
    heroImageUrl,
  });

  it("shows a photo saved with only its address", () => {
    expect(tweetImage(post([{ type: "photo", url: "https://pbs.test/a.jpg" }]))).toBe(
      "https://pbs.test/a.jpg",
    );
  });

  it("prefers the preview when there is one", () => {
    expect(
      tweetImage(
        post([
          { type: "photo", url: "https://pbs.test/big.jpg", previewUrl: "https://pbs.test/s.jpg" },
        ]),
      ),
    ).toBe("https://pbs.test/s.jpg");
  });

  it("shows a video's still, never the video file", () => {
    expect(
      tweetImage(
        post([
          { type: "video", url: "https://v.test/a.mp4", previewUrl: "https://pbs.test/v.jpg" },
        ]),
      ),
    ).toBe("https://pbs.test/v.jpg");
    expect(
      tweetImage(post([{ type: "video", url: "https://v.test/a.mp4" }], "https://v.test/a.mp4")),
    ).toBeNull();
  });

  it("falls back to the clip's picture when no media was kept", () => {
    expect(tweetImage(post(undefined, "https://pbs.test/h.jpg"))).toBe("https://pbs.test/h.jpg");
    expect(tweetImage(post(undefined))).toBeNull();
  });

  it("shows nothing for anything that is not a post", () => {
    expect(tweetImage({ sourceType: "web", heroImageUrl: "https://e.test/h.jpg" })).toBeNull();
  });
});
