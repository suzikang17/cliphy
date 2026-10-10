import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { browserMock } from "../../../test/browser-mock";
import {
  clearDone,
  loadOrganizerState,
  pruneTabsCache,
  loadProposals,
  saveProposals,
  saveAssignments,
  saveDismissed,
  setOverride,
} from "../cache";
import { resolveGroup } from "../organize";

type Area = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

function memoryArea(area: Area) {
  const data: Record<string, unknown> = {};
  area.get.mockImplementation(async (keys: string | string[] | null) => {
    if (keys === null) return { ...data };
    const out: Record<string, unknown> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) if (k in data) out[k] = data[k];
    return out;
  });
  area.set.mockImplementation(async (items: Record<string, unknown>) => {
    Object.assign(data, items);
  });
  area.remove.mockImplementation(async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
  });
  return data;
}

describe("tabs cache", () => {
  let session: Record<string, unknown>;
  let local: Record<string, unknown>;
  const url = "https://linear.app/acme/1";
  const tab = {
    id: 1,
    windowId: 1,
    url,
    title: "t",
    active: false,
    lastAccessed: 1,
    discarded: false,
  };

  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
    session = memoryArea(browserMock.storage.session);
    local = memoryArea(browserMock.storage.local);
  });

  it("round-trips assignments, done and dismissed", async () => {
    await saveAssignments({ [url]: { proposed: "acme" } }, [url]);
    await saveDismissed(new Set(["x"]));
    const s = await loadOrganizerState([url]);
    expect(s.assignments[url]).toEqual({ proposed: "acme" });
    expect(s.done.has(url)).toBe(true);
    expect([...s.dismissed]).toEqual(["x"]);
    await clearDone(url);
    expect((await loadOrganizerState([url])).done.has(url)).toBe(false);
  });

  it("override persists to storage.local, clears done, and wins on load", async () => {
    await saveAssignments({ [url]: { tag: "client:acme" } }, [url]);
    await setOverride(url, "tag:client:nourish");
    expect(local[`tabs:override:${url}`]).toBe("tag:client:nourish");
    expect(session[`tabs:done:${url}`]).toBeUndefined();

    // New browser session: session storage wiped, local survives.
    for (const k of Object.keys(session)) delete session[k];
    const s = await loadOrganizerState([url]);
    expect(s.overrides[url]).toBe("tag:client:nourish");
    expect(resolveGroup(tab, s)).toBe("tag:client:nourish");
  });

  it("groupings survive an extension reload (storage.session wiped) — 2026-10-10", async () => {
    await saveAssignments({ [url]: { tag: "client:acme" } }, [url]);
    await saveDismissed(new Set(["trip:tokyo"]));
    for (const k of Object.keys(session)) delete session[k]; // reload clears session storage

    const state = await loadOrganizerState([url]);
    expect(state.assignments[url]).toEqual({ tag: "client:acme" });
    expect(state.done.has(url)).toBe(true);
    expect(state.dismissed.has("trip:tokyo")).toBe(true);
  });

  it("still reads groupings saved by the previous (session-only) version", async () => {
    session[`tabs:assign:${url}`] = { tag: "legacy" };
    const state = await loadOrganizerState([url]);
    expect(state.assignments[url]).toEqual({ tag: "legacy" });
  });

  it("ignores entries older than 30 days; pruning drops them and caps the cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-01T00:00:00Z"));
    await saveAssignments({ [url]: { tag: "old" } }, []);
    vi.setSystemTime(Date.parse("2026-10-10T00:00:00Z"));
    expect((await loadOrganizerState([url])).assignments[url]).toBeUndefined();

    for (let i = 0; i < 2005; i++) {
      vi.setSystemTime(Date.parse("2026-10-10T00:00:00Z") + i);
      await saveAssignments({ [`https://x.com/${i}`]: { tag: "t" } }, []);
    }
    await pruneTabsCache();
    const keys = Object.keys(local).filter((k) => k.startsWith("tabs:assign:"));
    expect(keys).toHaveLength(2000);
    expect(keys).not.toContain(`tabs:assign:${url}`); // expired
    expect(keys).not.toContain("tabs:assign:https://x.com/0"); // oldest beyond the cap
    vi.useRealTimers();
  });

  it("persists suggestion reasons and keywords", async () => {
    await saveProposals({
      "freelance:lotus-bech": { reason: "Used together", keywords: ["lotus"] },
    });
    expect(await loadProposals()).toEqual({
      "freelance:lotus-bech": expect.objectContaining({
        reason: "Used together",
        keywords: ["lotus"],
      }),
    });
  });
});
