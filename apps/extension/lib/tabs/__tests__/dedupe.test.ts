import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { normalizeUrl, findDuplicates, pickKeeper, decideIntercept } from "../dedupe";
import type { OpenTab } from "../types";

const tab = (id: number, url: string, extra: Partial<OpenTab> = {}): OpenTab => ({
  id,
  windowId: 1,
  url,
  title: url,
  active: false,
  lastAccessed: id * 1000,
  discarded: false,
  ...extra,
});

describe("dedupe", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — duplicates");
  });

  describe("normalizeUrl", () => {
    it.each([
      ["https://www.Example.com/a/", "https://example.com/a"],
      ["https://example.com/a#section-2", "https://example.com/a"],
      ["https://example.com/a?utm_source=x&utm_medium=y", "https://example.com/a"],
      ["https://example.com/a?b=2&fbclid=z&a=1", "https://example.com/a?a=1&b=2"],
      ["https://youtu.be/x?si=abc", "https://youtu.be/x"],
      ["http://example.com/", "http://example.com/"],
    ])("%s → %s", (input, expected) => {
      expect(normalizeUrl(input)).toBe(expected);
    });

    it("keeps meaningful params distinct", () => {
      expect(normalizeUrl("https://youtube.com/watch?v=A")).not.toBe(
        normalizeUrl("https://youtube.com/watch?v=B"),
      );
    });

    it("returns null for non-web urls", () => {
      expect(normalizeUrl("chrome://newtab/")).toBeNull();
      expect(normalizeUrl("not a url")).toBeNull();
    });
  });

  it("findDuplicates groups only pages open more than once", () => {
    const dupes = findDuplicates([
      tab(1, "https://a.com/x"),
      tab(2, "https://www.a.com/x#top"),
      tab(3, "https://a.com/y"),
      tab(4, "https://a.com/x?utm_campaign=z"),
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].map((t) => t.id).sort()).toEqual([1, 2, 4]);
  });

  it("pickKeeper prefers the active tab, then most recently viewed", () => {
    expect(pickKeeper([tab(1, "u"), tab(5, "u"), tab(3, "u")]).id).toBe(5);
    expect(pickKeeper([tab(1, "u", { active: true }), tab(5, "u")]).id).toBe(1);
  });

  it("hash routes are different pages; plain #anchors are the same page", () => {
    const tabs = [
      tab(1, "https://mail.google.com/mail/u/0/#inbox/FMfcgz1"),
      tab(2, "https://mail.google.com/mail/u/0/#inbox/FMfcgz2"),
      tab(3, "https://app.example.com/#/settings"),
      tab(4, "https://app.example.com/#/billing"),
      tab(5, "https://docs.example.com/guide#install"),
      tab(6, "https://docs.example.com/guide#usage"),
    ];
    expect(findDuplicates(tabs).map((c) => c.map((t) => t.id))).toEqual([[5, 6]]);
  });

  describe("decideIntercept", () => {
    const existing = tab(1, "https://linear.app/i/ENG-1", { windowId: 2 });
    const others = [existing, tab(2, "https://other.com")];

    it("switches to the existing tab when a new foreground tab duplicates it", () => {
      const fresh = tab(9, "https://linear.app/i/ENG-1#c", { active: true });
      expect(
        decideIntercept({ newTab: fresh, allTabs: [...others, fresh], enabled: true, bypass: [] }),
      ).toEqual({ action: "switch", existing });
    });

    it("closes a background duplicate quietly without switching", () => {
      const fresh = tab(9, "https://linear.app/i/ENG-1", { active: false });
      expect(
        decideIntercept({ newTab: fresh, allTabs: [...others, fresh], enabled: true, bypass: [] }),
      ).toEqual({ action: "closeQuietly", existing });
    });

    it("does nothing when disabled, not a duplicate, or bypassed (Undo)", () => {
      const fresh = tab(9, "https://linear.app/i/ENG-1", { active: true });
      const all = [...others, fresh];
      expect(decideIntercept({ newTab: fresh, allTabs: all, enabled: false, bypass: [] })).toEqual({
        action: "none",
      });
      expect(
        decideIntercept({
          newTab: tab(9, "https://new.com", { active: true }),
          allTabs: [...others, tab(9, "https://new.com")],
          enabled: true,
          bypass: [],
        }),
      ).toEqual({ action: "none" });
      expect(
        decideIntercept({
          newTab: fresh,
          allTabs: all,
          enabled: true,
          bypass: ["https://linear.app/i/ENG-1"],
        }),
      ).toEqual({ action: "none" });
    });

    it("keeps the most recently viewed of several existing copies", () => {
      const older = tab(3, "https://a.com/x", { lastAccessed: 100 });
      const newer = tab(4, "https://a.com/x", { lastAccessed: 900 });
      const fresh = tab(9, "https://a.com/x", { active: true, lastAccessed: 1000 });
      expect(
        decideIntercept({
          newTab: fresh,
          allTabs: [older, newer, fresh],
          enabled: true,
          bypass: [],
        }),
      ).toEqual({ action: "switch", existing: newer });
    });
  });
});

describe("duplicateIdsToClose", () => {
  it("closes every copy except the keeper of each duplicated page", async () => {
    const { duplicateIdsToClose } = await import("../dedupe");
    const t = (id: number, url: string, extra: Partial<OpenTab> = {}): OpenTab => ({
      id,
      windowId: 1,
      url,
      title: url,
      active: false,
      lastAccessed: id,
      discarded: false,
      ...extra,
    });
    expect(
      duplicateIdsToClose([
        t(1, "https://a.com/x"),
        t(2, "https://a.com/x#y", { active: true }),
        t(3, "https://a.com/x"),
        t(4, "https://b.com"),
      ]).sort(),
    ).toEqual([1, 3]);
  });
});

describe("nestDuplicates", () => {
  const t = (id: number, url: string, extra: Partial<OpenTab> = {}): OpenTab => ({
    id,
    windowId: 1,
    url,
    title: url,
    active: false,
    lastAccessed: 100 - id,
    discarded: false,
    ...extra,
  });

  it("puts copies of a page under one parent (the keeper), keeping list order", async () => {
    const { nestDuplicates } = await import("../dedupe");
    const nested = nestDuplicates([
      t(1, "https://wix.com/home"),
      t(2, "https://other.com"),
      t(3, "https://www.wix.com/home#top"),
      t(4, "https://wix.com/home", { active: true }),
    ]);
    expect(nested.map((n) => [n.parent.id, n.children.map((c) => c.id)])).toEqual([
      [4, [1, 3]], // active copy is the parent; sits where the page first appeared
      [2, []],
    ]);
  });

  it("leaves unique pages as parents with no children", async () => {
    const { nestDuplicates } = await import("../dedupe");
    expect(
      nestDuplicates([t(1, "https://a.com"), t(2, "https://b.com")]).every(
        (n) => !n.children.length,
      ),
    ).toBe(true);
  });
});
