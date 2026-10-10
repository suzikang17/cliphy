import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { createOrderMemo, reseedGroups, stableOrder } from "../stableOrder";
import type { TabGroup } from "../organize";
import type { OpenTab } from "../types";

const tab = (id: number): OpenTab =>
  ({
    id,
    windowId: 1,
    url: `https://x.com/${id}`,
    title: `T${id}`,
    active: false,
    lastAccessed: id,
    discarded: false,
  }) as OpenTab;
const group = (key: string, ids: number[]): TabGroup =>
  ({ key, kind: "tag", value: key, label: key, tabs: ids.map(tab) }) as TabGroup;
const keys = (gs: TabGroup[]) => gs.map((g) => `${g.key}:${g.tabs.map((t) => t.id).join(",")}`);

describe("stableOrder (the list doesn't jump while you use it)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — layout");
  });

  it("keeps the first order even when the freshly sorted list changes", () => {
    const memo = createOrderMemo();
    expect(keys(stableOrder([group("a", [1, 2]), group("b", [3])], memo))).toEqual([
      "a:1,2",
      "b:3",
    ]);
    // You clicked tab 3 (b is now "most recent") and tab 2 (now first in a).
    expect(keys(stableOrder([group("b", [3]), group("a", [2, 1])], memo))).toEqual([
      "a:1,2",
      "b:3",
    ]);
  });

  it("new tabs and new groups appear at the top, newest first", () => {
    const memo = createOrderMemo();
    stableOrder([group("a", [1, 2])], memo);
    expect(keys(stableOrder([group("a", [2, 1, 9]), group("c", [7])], memo))).toEqual([
      "c:7",
      "a:9,1,2",
    ]);
  });

  it("a tab that moves to another group keeps its place relative to that group's tabs", () => {
    const memo = createOrderMemo();
    stableOrder([group("a", [1, 2]), group("b", [3, 4])], memo);
    expect(keys(stableOrder([group("a", [1]), group("b", [3, 2, 4])], memo))).toEqual([
      "a:1",
      "b:2,3,4",
    ]);
  });

  it("after you reorder groups yourself, that order is taken fresh", () => {
    const memo = createOrderMemo();
    stableOrder([group("a", [1]), group("b", [2])], memo);
    reseedGroups(memo);
    expect(keys(stableOrder([group("b", [2]), group("a", [1])], memo))).toEqual(["b:2", "a:1"]);
  });

  it("an empty first pass (tabs not loaded yet) doesn't count as the first order", () => {
    const memo = createOrderMemo();
    stableOrder([], memo);
    expect(keys(stableOrder([group("a", [1, 2]), group("b", [3])], memo))).toEqual([
      "a:1,2",
      "b:3",
    ]);
  });
});
