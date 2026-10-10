import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { suggestKeywords } from "../keywordSuggest";

const tab = (title: string, url = "https://example.com/x") => ({ title, url });

describe("suggestKeywords", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — keyword suggestions");
  });

  // Titles from the real Lotus Bech group (2026-10-10).
  const lotus = [
    tab("We curate life | interior design", "https://wecuratelife.com/"),
    tab(
      "Start collaborating on We Curate Life - suzi",
      "https://mail.google.com/mail/u/0/#inbox/1",
    ),
    tab(
      "Lotus Bech - We Curate Life - Website - Google Drive",
      "https://drive.google.com/drive/folders/18y",
    ),
    tab("We Curate Life — Refined Living", "https://wecuratelife-mockups.vercel.app/e"),
    tab("Refined Living", "https://wecuratelife-mockups.vercel.app/c"),
  ];
  const others = [
    tab("Home - TypeSafe AI", "https://typesafe.ai/"),
    tab("Usage", "https://console.typesafe.ai/usage"),
    tab("Dashboard – Stripe", "https://dashboard.stripe.com/invoices"),
    tab("Home | Wix.com", "https://www.wix.com/"),
  ];

  it("finds the distinctive shared phrase, longest form first", () => {
    expect(suggestKeywords(lotus, others, [])[0]).toBe("we curate life");
  });

  it("never suggests sub-phrases of a better suggestion or generic words", () => {
    const s = suggestKeywords(lotus, others, []);
    expect(s).not.toContain("curate life");
    expect(s).not.toContain("we curate");
    for (const generic of ["home", "website", "google", "drive", "design", "start"]) {
      expect(s).not.toContain(generic);
    }
  });

  it("skips phrases that also appear in other groups", () => {
    const shared = [...others, tab("Refined Living — another brand", "https://other.com")];
    expect(suggestKeywords(lotus, shared, [])).not.toContain("refined living");
  });

  it("skips what existing keywords already cover (spacing-insensitive)", () => {
    expect(suggestKeywords(lotus, others, ["wecuratelife"])).not.toContain("we curate life");
  });

  it("needs at least two tabs to agree", () => {
    expect(suggestKeywords([tab("Olive Ateliers | Furniture")], others, [])).toEqual([]);
  });

  it("returns at most two suggestions", () => {
    expect(suggestKeywords(lotus, others, []).length).toBeLessThanOrEqual(2);
  });
});
