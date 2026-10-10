import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import {
  DONE_GROUP,
  MAX_ORGANIZE_BATCH,
  applyOrganizeResponse,
  buildTabInput,
  emptyOrganizerState,
  groupLabel,
  mergeGroups,
  moveTargets,
  resolveGroup,
  selectTabsToSend,
  shouldExtract,
  type OrganizerState,
} from "../organize";
import type { OpenTab } from "../types";

let nextId = 1;
function tab(url: string, over: Partial<OpenTab> = {}): OpenTab {
  const id = nextId++;
  return {
    id,
    windowId: 1,
    url,
    title: `Tab ${id}`,
    active: false,
    lastAccessed: id * 1000,
    discarded: false,
    ...over,
  };
}

function state(over: Partial<OrganizerState> = {}): OrganizerState {
  return { ...emptyOrganizerState(), ...over };
}

describe("organize: merge precedence", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
  });

  const url = "https://linear.app/acme/issue/1";

  it("falls back to the site group with no assignment", () => {
    expect(resolveGroup(tab(url), state())).toBe("site:linear.app");
  });

  it("server tag beats site; none falls back to site", () => {
    expect(resolveGroup(tab(url), state({ assignments: { [url]: { tag: "client:acme" } } }))).toBe(
      "tag:client:acme",
    );
    expect(resolveGroup(tab(url), state({ assignments: { [url]: { none: true } } }))).toBe(
      "site:linear.app",
    );
  });

  it("proposed groups unless dismissed", () => {
    const s = state({ assignments: { [url]: { proposed: "recipes" } } });
    expect(resolveGroup(tab(url), s)).toBe("proposed:recipes");
    s.dismissed.add("recipes");
    expect(resolveGroup(tab(url), s)).toBe("site:linear.app");
  });

  it("done beats the server assignment", () => {
    const s = state({ assignments: { [url]: { tag: "client:acme" } }, done: new Set([url]) });
    expect(resolveGroup(tab(url), s)).toBe(DONE_GROUP);
  });

  it("override beats done and the server assignment", () => {
    const s = state({
      assignments: { [url]: { tag: "client:acme" } },
      done: new Set([url]),
      overrides: { [url]: "tag:client:nourish" },
    });
    expect(resolveGroup(tab(url), s)).toBe("tag:client:nourish");
  });

  it("orders groups: active first, then most recent; done last; rows by recency", () => {
    const old = tab("https://a.com/1", { lastAccessed: 100 });
    const activeTab = tab("https://b.com/1", { lastAccessed: 50, active: true });
    const recent = tab("https://c.com/1", { lastAccessed: 900 });
    const recent2 = tab("https://c.com/2", { lastAccessed: 950 });
    const doneTab = tab("https://d.com/1", { lastAccessed: 9999 });
    const groups = mergeGroups(
      [old, activeTab, recent, recent2, doneTab],
      state({ done: new Set([doneTab.url]) }),
    );
    expect(groups.map((g) => g.key)).toEqual(["site:b.com", "site:c.com", "site:a.com", "done"]);
    expect(groups[1].tabs.map((t) => t.url)).toEqual(["https://c.com/2", "https://c.com/1"]);
    expect(groups[3].label).toBe("Probably done");
  });

  it("labels tag paths with ›", () => {
    expect(groupLabel("tag:client:acme")).toBe("client › acme");
    expect(groupLabel("site:github.com")).toBe("github.com");
  });

  it("move targets list shown non-done groups plus known tags, deduped", () => {
    const g = mergeGroups([tab("https://a.com")], state());
    expect(moveTargets(g, ["client:acme"])).toEqual(["site:a.com", "tag:client:acme"]);
  });
});

describe("organize: what gets sent", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
  });

  it("sends only uncached, non-overridden URLs, most recent first, one per URL", () => {
    const cached = tab("https://a.com/cached", { lastAccessed: 500 });
    const overridden = tab("https://a.com/moved", { lastAccessed: 600 });
    const older = tab("https://b.com/old", { lastAccessed: 100 });
    const newer = tab("https://b.com/new", { lastAccessed: 300 });
    const dup = tab("https://b.com/new", { lastAccessed: 200 });
    const picked = selectTabsToSend([cached, overridden, older, newer, dup], {
      assignments: { [cached.url]: { tag: "x" } },
      overrides: { [overridden.url]: "site:a.com" },
    });
    expect(picked.map((t) => t.id)).toEqual([newer.id, older.id]);
  });

  it("caps a batch at 60, keeping the most recently accessed", () => {
    const many = Array.from({ length: 75 }, (_, i) =>
      tab(`https://s.com/${i}`, { lastAccessed: i }),
    );
    const picked = selectTabsToSend(many, { assignments: {}, overrides: {} });
    expect(MAX_ORGANIZE_BATCH).toBe(60);
    expect(picked).toHaveLength(60);
    expect(picked[0].lastAccessed).toBe(74);
    expect(picked.at(-1)?.lastAccessed).toBe(15);
  });

  it("reads content only with permission and for loaded tabs", () => {
    expect(shouldExtract(tab("https://a.com"), true)).toBe(true);
    expect(shouldExtract(tab("https://a.com"), false)).toBe(false);
    expect(shouldExtract(tab("https://a.com", { discarded: true }), true)).toBe(false);
  });

  it("falls back to title + url when extraction is missing or skipped", () => {
    const t = tab("https://a.com", { id: 7, title: "A" });
    const base = { key: "7", url: "https://a.com", title: "A" };
    expect(buildTabInput(t, null)).toEqual(base);
    expect(buildTabInput(t, { skipped: "sensitive" })).toEqual(base);
  });

  it("includes description, text and scrolledToEnd when extracted", () => {
    const t = tab("https://a.com", { id: 8, title: "A" });
    expect(
      buildTabInput(t, { title: "A", description: "d", text: "body", scrolledToEnd: true }),
    ).toEqual({
      key: "8",
      url: "https://a.com",
      title: "A",
      description: "d",
      text: "body",
      scrolledToEnd: true,
    });
  });

  it("maps keyed responses to URLs; missing keys become none", () => {
    const a = tab("https://a.com", { id: 1 });
    const b = tab("https://b.com", { id: 2 });
    const res = applyOrganizeResponse([a, b], {
      assignments: { "1": { tag: "client:acme" } },
      done: ["2"],
    });
    expect(res.assignments).toEqual({
      "https://a.com": { tag: "client:acme" },
      "https://b.com": { none: true },
    });
    expect(res.done).toEqual(["https://b.com"]);
  });

  describe("keywords", () => {
    const kws = { "project:lotus-bech": ["we curate life"] };

    it("a keyword match groups the tab under the tag before any server answer", () => {
      const t = tab("https://wecuratelife-mockups.vercel.app/a", { title: "Mockups" });
      expect(resolveGroup(t, state(), kws)).toBe("tag:project:lotus-bech");
    });

    it("keywords beat a server assignment, but a manual override and done still win", () => {
      const url = "https://wecuratelife-mockups.vercel.app/a";
      const t = tab(url, { title: "Mockups" });
      expect(resolveGroup(t, state({ assignments: { [url]: { tag: "design" } } }), kws)).toBe(
        "tag:project:lotus-bech",
      );
      expect(resolveGroup(t, state({ overrides: { [url]: "tag:design" } }), kws)).toBe(
        "tag:design",
      );
      expect(resolveGroup(t, state({ done: new Set([url]) }), kws)).toBe(DONE_GROUP);
    });

    it("mergeGroups applies keywords", () => {
      const groups = mergeGroups(
        [tab("https://wecuratelife-mockups.vercel.app/a"), tab("https://other.com")],
        state(),
        kws,
      );
      expect(groups.map((g) => g.key).sort()).toEqual(["site:other.com", "tag:project:lotus-bech"]);
    });
  });
});

describe("normalizeTagName", () => {
  it("lowercases, trims each level, collapses spaces, keeps ':' nesting", async () => {
    const { normalizeTagName } = await import("../useTabOrganizer");
    expect(normalizeTagName("  Freelance :  Lotus   Bech ")).toBe("freelance:lotus bech");
    expect(normalizeTagName("::a::b::")).toBe("a:b");
    expect(normalizeTagName("x".repeat(40))).toHaveLength(30);
  });
});

describe("organize: one page, one group", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — groups");
  });

  it("two tabs of the same page always land in the same group, even if only one was moved", () => {
    const a = tab("https://a.com/x?utm_source=news");
    const b = tab("https://www.a.com/x/");
    const groups = mergeGroups([a, b], state({ overrides: { [a.url]: "tag:project:lotus" } }));
    const holding = groups.filter((g) => g.tabs.some((t) => t.id === a.id || t.id === b.id));
    expect(holding.map((g) => g.key)).toEqual(["tag:project:lotus"]);
    expect(holding[0].tabs.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("an AI tag for one copy beats a bare site group for the other", () => {
    const a = tab("https://a.com/y");
    const b = tab("https://a.com/y?utm_campaign=z");
    const groups = mergeGroups([a, b], state({ assignments: { [a.url]: { tag: "reading" } } }));
    expect(groups.map((g) => g.key)).toEqual(["tag:reading"]);
  });

  it("different Gmail threads stay separate pages", () => {
    const a = tab("https://mail.google.com/mail/u/0/#inbox/A");
    const b = tab("https://mail.google.com/mail/u/0/#inbox/B");
    const groups = mergeGroups([a, b], state({ overrides: { [a.url]: "tag:work" } }));
    expect(groups.find((g) => g.key === "tag:work")!.tabs.map((t) => t.id)).toEqual([a.id]);
  });
});
