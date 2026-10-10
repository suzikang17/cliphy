import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { isStale, staleTabs, STALE_AFTER_MS } from "../stale";
import type { OpenTab } from "../types";

const now = Date.parse("2026-10-10T12:00:00Z");
let nextId = 1;
const tab = (url: string, lastAccessed: number, extra: Partial<OpenTab> = {}): OpenTab =>
  ({
    id: nextId++,
    windowId: 1,
    url,
    title: url,
    lastAccessed,
    active: false,
    ...extra,
  }) as OpenTab;

describe("stale tabs", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — stale tabs");
  });

  it("a tab untouched for more than 3 days is stale", () => {
    expect(STALE_AFTER_MS).toBe(3 * 86_400_000);
    expect(isStale({ lastAccessed: now - STALE_AFTER_MS - 1 }, now)).toBe(true);
    expect(isStale({ lastAccessed: now - STALE_AFTER_MS + 1 }, now)).toBe(false);
  });

  it("an unknown last-access time is never stale", () => {
    expect(isStale({ lastAccessed: 0 }, now)).toBe(false);
    expect(isStale({ lastAccessed: undefined }, now)).toBe(false);
  });

  it("staleTabs excludes pinned and active tabs and lists oldest first", () => {
    const old = now - 10 * 86_400_000;
    const older = now - 20 * 86_400_000;
    const tabs = [
      tab("https://a.com/x", old),
      tab("https://b.com/y", older),
      tab("https://pinned.com/p", older),
      tab("https://active.com/z", older, { active: true }),
      tab("https://fresh.com/f", now - 1000),
    ];
    const out = staleTabs(tabs, new Set(["https://pinned.com/p"]), now);
    expect(out.map((t) => t.url)).toEqual(["https://b.com/y", "https://a.com/x"]);
  });
});
