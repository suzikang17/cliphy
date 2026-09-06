import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { rankSites } from "../historySuggestions";

const item = (url: string, visitCount: number, typedCount = 0, title = "") => ({
  url,
  title,
  visitCount,
  typedCount,
});

describe("rankSites", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("History suggestions");
  });

  it("groups many pages of one site into a single suggestion", () => {
    const out = rankSites([
      item("https://linear.app/team/ENG/issue/1", 10),
      item("https://linear.app/team/ENG/issue/2", 12),
      item("https://linear.app/inbox", 8),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].host).toBe("linear.app");
    expect(out[0].visits).toBe(30);
  });

  it("weights typed visits above clicked ones", () => {
    // A destination you type beats a docs page you click into more often.
    const out = rankSites([
      item("https://typed.test/", 10, 10),
      item("https://clicked.test/", 25, 0),
    ]);
    expect(out[0].host).toBe("typed.test");
  });

  it("strips www so it does not split a site in two", () => {
    const out = rankSites([item("https://www.github.com/a", 5), item("https://github.com/b", 5)]);
    expect(out).toHaveLength(1);
    expect(out[0].host).toBe("github.com");
  });

  it("drops search engine result pages", () => {
    const out = rankSites([
      item("https://www.google.com/search?q=cats", 500),
      item("https://duckduckgo.com/?q=dogs", 300),
      item("https://linear.app/", 5),
    ]);
    expect(out.map((s) => s.host)).toEqual(["linear.app"]);
  });

  it("drops non-http entries", () => {
    const out = rankSites([
      item("chrome://extensions", 99),
      item("file:///Users/x/notes.md", 40),
      item("https://linear.app/", 3),
    ]);
    expect(out.map((s) => s.host)).toEqual(["linear.app"]);
  });

  it("excludes origins that are already pinned", () => {
    const out = rankSites([item("https://linear.app/", 50), item("https://vercel.com/", 40)], {
      excludeOrigins: ["https://linear.app"],
    });
    expect(out.map((s) => s.host)).toEqual(["vercel.com"]);
  });

  it("returns the highest scoring sites first, capped by limit", () => {
    const out = rankSites(
      [item("https://a.test/", 1), item("https://b.test/", 50), item("https://c.test/", 20)],
      { limit: 2 },
    );
    expect(out.map((s) => s.host)).toEqual(["b.test", "c.test"]);
  });

  it("labels a site by host, not by whatever page title happened to rank", () => {
    const out = rankSites([
      item("https://linear.app/issue/1", 9, 0, "ENG-412 · Fix the thing · Linear"),
    ]);
    expect(out[0].host).toBe("linear.app");
    expect(out[0].origin).toBe("https://linear.app");
  });

  it("survives malformed urls without throwing", () => {
    const out = rankSites([
      { url: "not a url", visitCount: 5 },
      { url: undefined, visitCount: 5 },
      item("https://linear.app/", 2),
    ]);
    expect(out.map((s) => s.host)).toEqual(["linear.app"]);
  });
});
