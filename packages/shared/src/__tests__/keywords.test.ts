import { describe, it, expect } from "vitest";
import { compactText, keywordMatches, matchKeywordTag, normalizeKeywords } from "../keywords";

describe("keywords", () => {
  it("compactText drops case, spaces and punctuation", () => {
    expect(compactText("We Curate-Life!")).toBe("wecuratelife");
    expect(compactText("https://wecuratelife-mockups.vercel.app/a")).toBe(
      "httpswecuratelifemockupsvercelappa",
    );
  });

  it("long keywords match glued text in URLs and titles", () => {
    const hay = { url: "https://wecuratelife-mockups.vercel.app/a", title: "Mockups" };
    expect(keywordMatches("we curate life", hay)).toBe(true);
    expect(
      keywordMatches("WeCurateLife", { url: "https://x.com", title: "WeCurateLife – Home" }),
    ).toBe(true);
    expect(
      keywordMatches("lotus", { url: "https://x.com", title: "x", text: "the Lotus brand" }),
    ).toBe(true);
  });

  it("short keywords (< 4 chars) must match a whole word", () => {
    expect(keywordMatches("ai", { url: "https://mail.google.com", title: "Inbox — email" })).toBe(
      false,
    );
    expect(keywordMatches("ai", { url: "https://x.com", title: "AI roadmap" })).toBe(true);
    expect(keywordMatches("bech", { url: "https://x.com/lotus-bech", title: "x" })).toBe(true);
  });

  it("matchKeywordTag returns the tag with the longest matching keyword", () => {
    const tags = {
      "project:lotus-bech": ["we curate life", "lotus"],
      "client:acme": ["acme"],
      reading: [],
    };
    expect(
      matchKeywordTag({ url: "https://wecuratelife-mockups.vercel.app/a", title: "Mockups" }, tags),
    ).toBe("project:lotus-bech");
    expect(matchKeywordTag({ url: "https://acme.com", title: "Acme" }, tags)).toBe("client:acme");
    expect(matchKeywordTag({ url: "https://other.com", title: "Other" }, tags)).toBeNull();
  });

  it("normalizeKeywords trims, lowercases, dedupes by compact form, drops empties, caps", () => {
    expect(
      normalizeKeywords([
        " We Curate Life ",
        "wecuratelife",
        "",
        "  ",
        "Lotus",
        42 as unknown as string,
      ]),
    ).toEqual(["we curate life", "lotus"]);
    expect(normalizeKeywords(Array.from({ length: 30 }, (_, i) => `kw${i}xx`))).toHaveLength(10);
    expect(normalizeKeywords(["x".repeat(60)])).toEqual(["x".repeat(40)]);
  });
});
