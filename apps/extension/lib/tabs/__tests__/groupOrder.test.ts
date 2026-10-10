import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { applyGroupOrder, reorderGroups, nudgeGroup } from "../groupOrder";
import type { TabGroup } from "../organize";

const g = (key: string): TabGroup =>
  ({
    key,
    kind: key === "done" ? "done" : (key.split(":")[0] as TabGroup["kind"]),
    value: key,
    label: key,
    tabs: [],
  }) as TabGroup;
const keys = (gs: TabGroup[]) => gs.map((x) => x.key);

describe("groupOrder", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — group order");
  });

  describe("applyGroupOrder", () => {
    // Auto order as produced by mergeGroups (done already last).
    const auto = [g("site:a.com"), g("tag:x"), g("site:b.com"), g("tag:y"), g("done")];

    it("returns the automatic order when nothing has been placed", () => {
      expect(keys(applyGroupOrder(auto, []))).toEqual(keys(auto));
    });

    it("puts placed groups first in your order, unplaced below in auto order, done last", () => {
      expect(keys(applyGroupOrder(auto, ["tag:y", "site:a.com"]))).toEqual([
        "tag:y",
        "site:a.com",
        "tag:x",
        "site:b.com",
        "done",
      ]);
    });

    it("skips placed groups that aren't open right now, and restores them when they return", () => {
      const without = auto.filter((x) => x.key !== "tag:y");
      expect(keys(applyGroupOrder(without, ["tag:y", "site:b.com"]))).toEqual([
        "site:b.com",
        "site:a.com",
        "tag:x",
        "done",
      ]);
      expect(keys(applyGroupOrder(auto, ["tag:y", "site:b.com"]))[0]).toBe("tag:y");
    });

    it("never moves Probably done out of last place", () => {
      expect(keys(applyGroupOrder(auto, ["done", "tag:x"])).at(-1)).toBe("done");
    });
  });

  describe("reorderGroups (drag and drop)", () => {
    const visible = ["tag:y", "site:a.com", "tag:x", "site:b.com"];

    it("drops a group before or after the target and places everything above the drop", () => {
      expect(reorderGroups(visible, [], "site:b.com", "site:a.com", "before")).toEqual([
        "tag:y",
        "site:b.com",
        "site:a.com",
      ]);
      expect(reorderGroups(visible, [], "tag:y", "tag:x", "after")).toEqual([
        "site:a.com",
        "tag:x",
        "tag:y",
      ]);
    });

    it("keeps remembered positions of groups that aren't open now", () => {
      expect(
        reorderGroups(visible, ["tag:gone", "tag:y"], "site:a.com", "tag:y", "before"),
      ).toEqual(["site:a.com", "tag:y", "tag:gone"]);
    });

    it("ignores drops onto itself or of the done group", () => {
      expect(reorderGroups(visible, ["tag:y"], "tag:x", "tag:x", "before")).toEqual(["tag:y"]);
      expect(reorderGroups([...visible, "done"], [], "done", "tag:y", "before")).toEqual([]);
    });
  });

  describe("nudgeGroup (⌥↑ / ⌥↓)", () => {
    const visible = ["tag:y", "site:a.com", "tag:x"];

    it("moves a group up or down one place", () => {
      // x moves above a.com; both are now pinned (same rule as drag)
      expect(nudgeGroup(visible, [], "tag:x", -1)).toEqual(["tag:y", "tag:x", "site:a.com"]);
      expect(nudgeGroup(visible, [], "tag:y", 1)).toEqual(["site:a.com", "tag:y"]);
    });

    it("is a no-op at the ends", () => {
      expect(nudgeGroup(visible, ["tag:y"], "tag:y", -1)).toEqual(["tag:y"]);
      expect(nudgeGroup(visible, [], "tag:x", 1)).toEqual([]);
    });
  });
});
