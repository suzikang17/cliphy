import { describe, it, expect } from "vitest";
import { cutTweetLink } from "../tweet";

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
