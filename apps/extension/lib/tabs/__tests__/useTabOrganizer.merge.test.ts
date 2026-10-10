// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const putTabHint = vi.fn().mockResolvedValue({ tag: "", hints: "", keywords: [] });
const putPageOverrides = vi.fn().mockResolvedValue({ saved: 0 });

vi.mock("../../auth", () => ({ isAuthenticated: vi.fn().mockResolvedValue(true) }));
vi.mock("../../api", () => ({
  AuthError: class extends Error {},
  RateLimitError: class extends Error {},
  getTabHints: vi.fn().mockResolvedValue({
    hints: { design: "interior studio work", ai: "AI tools" },
    keywords: { design: ["we curate life"], ai: ["typesafe"] },
  }),
  organizeTabs: vi.fn().mockResolvedValue({
    assignments: { "1": { tag: "ai" }, "2": { tag: "ai" }, "3": { tag: "design" } },
    done: [],
  }),
  putTabHint: (...a: unknown[]) => putTabHint(...a),
  putPageOverrides: (...a: unknown[]) => putPageOverrides(...a),
  stowTab: vi.fn(),
}));
vi.mock("../openedAt", () => ({
  loadOpenedTimes: vi.fn().mockResolvedValue({ opened: {}, trackingSince: null }),
}));
vi.mock("../activity", () => ({
  loadActivity: vi.fn().mockResolvedValue({ switches: [], openers: {} }),
}));

const { useTabOrganizer } = await import("../useTabOrganizer");

// In-memory storage so overrides/aliases round-trip through the cache layer.
let local: Record<string, unknown> = {};
let session: Record<string, unknown> = {};
const area = (store: () => Record<string, unknown>) => ({
  get: vi.fn(async (k: string | string[] | null) => {
    const s = store();
    if (k === null) return { ...s };
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter((x) => x in s).map((x) => [x, s[x]]));
  }),
  set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store(), o)),
  remove: vi.fn(async (k: string | string[]) => {
    for (const x of Array.isArray(k) ? k : [k]) delete store()[x];
  }),
});

describe("useTabOrganizer — merging groups", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — merge");
    vi.clearAllMocks();
    local = {};
    session = {};
    Object.assign(
      browserMock.storage.local,
      area(() => local),
    );
    Object.assign(
      browserMock.storage.session,
      area(() => session),
    );
    browserMock.permissions.contains.mockResolvedValue(false);
    browserMock.windows.getCurrent.mockResolvedValue({ id: 1 });
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, windowId: 1, url: "https://typesafe.ai", title: "TypeSafe", lastAccessed: 3 },
      { id: 2, windowId: 1, url: "https://console.typesafe.ai", title: "Usage", lastAccessed: 2 },
      { id: 3, windowId: 1, url: "https://wecuratelife.com", title: "WCL", lastAccessed: 1 },
    ]);
  });

  it("moves the tabs, combines keywords/hints, aliases the old tag — and undo restores it all", async () => {
    const { result } = renderHook(() => useTabOrganizer());
    await waitFor(() =>
      expect(result.current.groups.map((g) => g.key).sort()).toEqual(["tag:ai", "tag:design"]),
    );
    const ai = result.current.groups.find((g) => g.key === "tag:ai")!;
    const design = result.current.groups.find((g) => g.key === "tag:design")!;

    let undo!: () => Promise<void>;
    await act(async () => {
      undo = await result.current.mergeGroup(ai, design);
    });

    expect(result.current.groups.map((g) => g.key)).toEqual(["tag:design"]);
    expect(result.current.groups[0].tabs).toHaveLength(3);
    expect(putTabHint).toHaveBeenCalledWith("design", "interior studio work; AI tools", {
      keep: true,
      keywords: ["we curate life", "typesafe"],
    });
    expect(local["tabs:tagAliases"]).toEqual({ ai: "design" });
    // Manual choices reach the server, so other devices see the merge…
    expect(putPageOverrides).toHaveBeenCalledWith([
      { url: "https://typesafe.ai", override: "tag:design" },
      { url: "https://console.typesafe.ai", override: "tag:design" },
    ]);

    await act(async () => {
      await undo();
    });
    // …and undo clears them there too.
    expect(putPageOverrides).toHaveBeenLastCalledWith([
      { url: "https://typesafe.ai", override: null },
      { url: "https://console.typesafe.ai", override: null },
    ]);
    expect(result.current.groups.map((g) => g.key).sort()).toEqual(["tag:ai", "tag:design"]);
    expect(putTabHint).toHaveBeenLastCalledWith("design", "interior studio work", {
      keep: true,
      keywords: ["we curate life"],
    });
    expect(local["tabs:tagAliases"]).toEqual({});
  });
});
