import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { sortTabs, moveInOrder } from "../tabSort";
import type { OpenTab } from "../types";

const tab = (id: number, url: string, title: string, lastAccessed: number): OpenTab =>
  ({ id, windowId: 1, url, title, active: false, lastAccessed, discarded: false }) as OpenTab;
const a = tab(1, "https://zeta.com/a", "Banana", 10);
const b = tab(2, "https://alpha.com/b", "apple", 30);
const c = tab(3, "https://mid.com/c", "Cherry", 20);
const ids = (ts: OpenTab[]) => ts.map((t) => t.id);

describe("sortTabs (order within a group)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — sort");
  });

  it("recent: last viewed first", () => {
    expect(ids(sortTabs([a, b, c], "recent", []))).toEqual([2, 3, 1]);
  });

  it("name: A–Z by your name for the page (case-insensitive)", () => {
    expect(ids(sortTabs([a, b, { ...c, customTitle: "aardvark" }], "name", []))).toEqual([3, 2, 1]);
  });

  it("site: by site, then name", () => {
    expect(ids(sortTabs([a, b, c], "site", []))).toEqual([2, 3, 1]);
  });

  it("your order: pages you placed keep their places; pages you haven't placed stay on top as they are", () => {
    const order = ["https://mid.com/c", "https://zeta.com/a"];
    expect(ids(sortTabs([a, b, c], "manual", order))).toEqual([2, 3, 1]);
    expect(ids(sortTabs([a, c], "manual", order))).toEqual([3, 1]);
  });

  it("moveInOrder places a page before another (or at the end) and returns the full new order", () => {
    const current = [a, b, c];
    expect(moveInOrder(current, c, a)).toEqual([
      "https://mid.com/c",
      "https://zeta.com/a",
      "https://alpha.com/b",
    ]);
    expect(moveInOrder(current, a, null)).toEqual([
      "https://alpha.com/b",
      "https://mid.com/c",
      "https://zeta.com/a",
    ]);
  });
});
