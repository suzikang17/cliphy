import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { buildClusters, type ClusterTab } from "../clusters";
import type { Activity, SwitchEntry } from "../activity";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date("2026-10-10T15:00:00").getTime();
const none: Activity = { switches: [], openers: {} };

const tab = (id: number, extra: Partial<ClusterTab> = {}): ClusterTab => ({
  id,
  windowId: 1,
  lastAccessed: NOW - HOUR,
  ...extra,
});

/** Alternate between a and b `n` times (n+1 entries), `step` ms apart, from `from`. */
function bounce(a: number, b: number, n: number, from: number, step = MIN): SwitchEntry[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ tabId: i % 2 ? b : a, at: from + i * step }));
}

describe("buildClusters", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — clusters");
  });

  it("returns nothing without evidence", () => {
    expect(buildClusters([tab(1), tab(2), tab(3)], none, NOW)).toEqual([]);
  });

  it("links a tab to the tab that opened it", () => {
    const tabs = [tab(1, { openedAt: NOW - 5 * HOUR }), tab(2, { openedAt: NOW - HOUR }), tab(3)];
    expect(buildClusters(tabs, { switches: [], openers: { 2: 1 } }, NOW)).toEqual([
      { keys: ["1", "2"], start: NOW - 5 * HOUR, end: NOW - HOUR, switches: 0, openerLinks: 1 },
    ]);
  });

  it("needs 3 direct switches between a pair, counting both directions", () => {
    const tabs = [tab(1), tab(2), tab(3)];
    expect(
      buildClusters(tabs, { switches: bounce(1, 2, 2, NOW - HOUR), openers: {} }, NOW),
    ).toEqual([]);
    const [c] = buildClusters(tabs, { switches: bounce(1, 2, 3, NOW - HOUR), openers: {} }, NOW);
    expect(c.keys).toEqual(["1", "2"]);
    expect(c.switches).toBe(3);
  });

  it("ignores switches more than 5 minutes apart", () => {
    const tabs = [tab(1), tab(2)];
    const slow = bounce(1, 2, 6, NOW - 2 * HOUR, 5 * MIN + 1);
    expect(buildClusters(tabs, { switches: slow, openers: {} }, NOW)).toEqual([]);
    const atLimit = bounce(1, 2, 3, NOW - 2 * HOUR, 5 * MIN);
    expect(buildClusters(tabs, { switches: atLimit, openers: {} }, NOW)).toHaveLength(1);
  });

  it("weakly links same-window tabs opened within 2 minutes", () => {
    const tabs = [
      tab(1, { openedAt: NOW - HOUR }),
      tab(2, { openedAt: NOW - HOUR + 2 * MIN }),
      tab(3, { openedAt: NOW - HOUR + MIN, windowId: 2 }), // other window
      tab(4, { openedAt: NOW - HOUR + 5 * MIN }), // too late
      tab(5), // open time unknown
    ];
    const clusters = buildClusters(tabs, none, NOW);
    expect(clusters.map((c) => c.keys)).toEqual([["1", "2"]]);
    expect(clusters[0]).toMatchObject({ switches: 0, openerLinks: 0, start: NOW - HOUR });
  });

  it("caps weak-edge chaining at 8 tabs", () => {
    // 20 tabs opened a minute apart all morning: every neighbor is a weak edge.
    const tabs = Array.from({ length: 20 }, (_, i) =>
      tab(i + 1, { openedAt: NOW - 5 * HOUR + i * MIN }),
    );
    const clusters = buildClusters(tabs, none, NOW);
    expect(clusters.length).toBeGreaterThan(1);
    for (const c of clusters) expect(c.keys.length).toBeLessThanOrEqual(8);
    expect(clusters.flatMap((c) => c.keys)).toHaveLength(20);
  });

  it("weak edges can't grow a strong cluster past 8", () => {
    const tabs = Array.from({ length: 9 }, (_, i) => tab(i + 1, { openedAt: NOW - HOUR }));
    const openers = { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 }; // 1–8 strong
    const clusters = buildClusters(tabs, { switches: [], openers }, NOW);
    expect(clusters.map((c) => c.keys)).toEqual([["1", "2", "3", "4", "5", "6", "7", "8"]]);
  });

  it("drops strong clusters larger than 12", () => {
    const tabs = Array.from({ length: 13 }, (_, i) => tab(i + 1));
    const openers = Object.fromEntries(tabs.slice(1).map((t) => [t.id, 1]));
    expect(buildClusters(tabs, { switches: [], openers }, NOW)).toEqual([]);
  });

  it("ignores closed tabs", () => {
    const tabs = [tab(1), tab(2)];
    const activity: Activity = { switches: bounce(1, 99, 6, NOW - HOUR), openers: { 2: 98 } };
    expect(buildClusters(tabs, activity, NOW)).toEqual([]);
  });

  it("sorts by strength, then size, and is deterministic", () => {
    const tabs = [1, 2, 3, 4, 5, 6, 7].map((id) => tab(id));
    const activity: Activity = {
      switches: [...bounce(1, 2, 3, NOW - 3 * HOUR), ...bounce(3, 4, 8, NOW - 2 * HOUR)],
      openers: { 6: 5, 7: 5 },
    };
    const a = buildClusters(tabs, activity, NOW);
    expect(a.map((c) => c.keys)).toEqual([
      ["3", "4"],
      ["5", "6", "7"],
      ["1", "2"],
    ]);
    expect(buildClusters([...tabs].reverse(), activity, NOW)).toEqual(a);
  });

  it("Stripe + Drive: opened a minute apart, used side by side → one cluster", () => {
    const stripe = 41;
    const drive = 42;
    const opened = NOW - 40 * MIN;
    const tabs: ClusterTab[] = [
      tab(10, { openedAt: NOW - 6 * HOUR, lastAccessed: NOW - 5 * HOUR }),
      tab(11, { openedAt: NOW - 5 * HOUR, lastAccessed: NOW - 4 * HOUR }),
      tab(12, { openedAt: NOW - 4 * HOUR, windowId: 2, lastAccessed: NOW - 3 * HOUR }),
      tab(stripe, { openedAt: opened, lastAccessed: NOW - 2 * MIN }),
      tab(drive, { openedAt: opened + MIN, lastAccessed: NOW - 3 * MIN }),
    ];
    const switches = [
      { tabId: 10, at: NOW - 5 * HOUR },
      { tabId: 11, at: NOW - 4 * HOUR },
      { tabId: 12, at: NOW - 3 * HOUR },
      ...bounce(stripe, drive, 6, opened + MIN, 3 * MIN),
    ];
    const clusters = buildClusters(tabs, { switches, openers: {} }, NOW);
    expect(clusters).toEqual([
      {
        keys: [String(stripe), String(drive)],
        start: opened,
        end: NOW - 2 * MIN, // Stripe was viewed most recently
        switches: 6,
        openerLinks: 0,
      },
    ]);
  });
});
