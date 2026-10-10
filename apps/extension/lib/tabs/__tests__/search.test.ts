import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { emptyOrganizerState, mergeGroups } from "../organize";
import { filterGroups, matchesQuery, moveSelection, rowToActivate, visibleRows } from "../search";
import type { OpenTab } from "../types";

function tab(id: number, url: string, title: string, lastAccessed = id): OpenTab {
  return { id, windowId: 1, url, title, active: false, lastAccessed, discarded: false };
}

const tabs = [
  tab(1, "https://github.com/acme/repo", "acme/repo: Pull requests", 10),
  tab(2, "https://github.com/other/thing", "Other thing", 9),
  tab(3, "https://linear.app/acme/issue/ACM-1", "Fix login", 8),
  tab(4, "https://news.site/story", "Big news", 7),
];

describe("tabs search + keyboard selection", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
  });

  it("matches title or URL, case-insensitively", () => {
    expect(matchesQuery(tabs[2], "ACME")).toBe(true); // url
    expect(matchesQuery(tabs[2], "login")).toBe(true); // title
    expect(matchesQuery(tabs[3], "acme")).toBe(false);
    expect(matchesQuery(tabs[3], "   ")).toBe(true);
  });

  it("filters rows and drops empty groups", () => {
    const groups = mergeGroups(tabs, emptyOrganizerState());
    const shown = filterGroups(groups, "acme");
    expect(shown.map((g) => g.key)).toEqual(["site:github.com", "site:linear.app"]);
    expect(shown[0].tabs.map((t) => t.id)).toEqual([1]);
    expect(filterGroups(groups, "")).toBe(groups);
  });

  it("skips collapsed groups unless searching", () => {
    const groups = mergeGroups(tabs, emptyOrganizerState());
    const collapsed = new Set(["site:github.com"]);
    expect(visibleRows(groups, collapsed, "").map((t) => t.id)).toEqual([3, 4]);
    expect(visibleRows(filterGroups(groups, "acme"), collapsed, "acme").map((t) => t.id)).toEqual([
      1, 3,
    ]);
  });

  it("moves selection with clamping; first ↓ selects the top, first ↑ the bottom", () => {
    expect(moveSelection(-1, 1, 4)).toBe(0);
    expect(moveSelection(-1, -1, 4)).toBe(3);
    expect(moveSelection(0, -1, 4)).toBe(0);
    expect(moveSelection(2, 1, 4)).toBe(3);
    expect(moveSelection(3, 1, 4)).toBe(3);
    expect(moveSelection(1, 1, 0)).toBe(-1);
  });

  it("Enter activates the selection, else the top match", () => {
    const rows = tabs.slice(0, 3);
    expect(rowToActivate(rows, 1)?.id).toBe(2);
    expect(rowToActivate(rows, -1)?.id).toBe(1);
    expect(rowToActivate(rows, 99)?.id).toBe(1);
    expect(rowToActivate([], 0)).toBeNull();
  });

  it("matches your custom name and note", async () => {
    const { matchesQuery } = await import("../search");
    const t = { title: "Dashboard – Stripe", url: "https://dashboard.stripe.com" };
    expect(matchesQuery({ ...t, customTitle: "Lotus invoice" }, "lotus")).toBe(true);
    expect(matchesQuery({ ...t, note: "waiting on client" }, "client")).toBe(true);
    expect(matchesQuery(t, "lotus")).toBe(false);
  });
});
