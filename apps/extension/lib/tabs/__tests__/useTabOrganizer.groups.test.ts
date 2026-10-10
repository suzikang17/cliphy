// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const api = vi.hoisted(() => ({
  closeGroupSnapshot: vi.fn(),
  resumeGroup: vi.fn(),
  getClosedGroups: vi.fn(),
}));
vi.mock("../../auth", () => ({ isAuthenticated: vi.fn().mockResolvedValue(true) }));
vi.mock("../../api", () => ({
  AuthError: class extends Error {},
  RateLimitError: class extends Error {},
  getTabHints: vi.fn().mockResolvedValue({ hints: {}, keywords: {} }),
  organizeTabs: vi.fn().mockResolvedValue({
    assignments: { "1": { tag: "lotus" }, "2": { tag: "lotus" }, "3": { tag: "other" } },
    done: [],
  }),
  putTabHint: vi.fn(),
  putPageOverrides: vi.fn().mockResolvedValue({ saved: 0 }),
  stowTab: vi.fn(),
  closeGroupSnapshot: (...a: unknown[]) => api.closeGroupSnapshot(...a),
  resumeGroup: (...a: unknown[]) => api.resumeGroup(...a),
  getClosedGroups: (...a: unknown[]) => api.getClosedGroups(...a),
}));
vi.mock("../openedAt", () => ({
  loadOpenedTimes: vi.fn().mockResolvedValue({ opened: {}, trackingSince: null }),
}));
vi.mock("../activity", () => ({
  loadActivity: vi.fn().mockResolvedValue({ switches: [], openers: {} }),
}));

const { useTabOrganizer } = await import("../useTabOrganizer");

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
const tabs = [
  { id: 1, windowId: 1, url: "https://drive.google.com/x", title: "Drive", lastAccessed: 3 },
  { id: 2, windowId: 1, url: "https://dashboard.stripe.com/", title: "Stripe", lastAccessed: 2 },
  { id: 3, windowId: 1, url: "https://other.com/", title: "Other", lastAccessed: 1 },
];

describe("useTabOrganizer — close & resume a group", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
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
    (browserMock.windows as Record<string, unknown>).create = vi.fn().mockResolvedValue({ id: 2 });
    browserMock.tabs.query.mockResolvedValue(tabs);
    browserMock.tabs.remove.mockResolvedValue(undefined);
    browserMock.tabs.create.mockResolvedValue({ id: 9 });
    api.getClosedGroups.mockResolvedValue({ groups: [] });
    api.closeGroupSnapshot.mockResolvedValue({ closedAt: "2026-10-10T10:00:00.000Z" });
  });

  async function ready() {
    const h = renderHook(() => useTabOrganizer());
    await waitFor(() => expect(h.result.current.groups.map((g) => g.key)).toContain("tag:lotus"));
    return h;
  }

  it("closeGroup snapshots the open pages, then closes the tabs", async () => {
    const { result } = await ready();
    const lotus = result.current.groups.find((g) => g.key === "tag:lotus")!;
    await act(async () => {
      await result.current.closeGroup(lotus);
    });
    expect(api.closeGroupSnapshot).toHaveBeenCalledWith("tag:lotus", "lotus", [
      { url: "https://drive.google.com/x", title: "Drive" },
      { url: "https://dashboard.stripe.com/", title: "Stripe" },
    ]);
    expect(browserMock.tabs.remove).toHaveBeenCalledWith([1, 2]);
    expect(result.current.closedGroups.map((g) => g.key)).toEqual(["tag:lotus"]);
  });

  it("still closes the tabs when the snapshot call fails, and keeps a local Resume row", async () => {
    api.closeGroupSnapshot.mockRejectedValue(new Error("offline"));
    const { result } = await ready();
    const lotus = result.current.groups.find((g) => g.key === "tag:lotus")!;
    await act(async () => {
      await result.current.closeGroup(lotus);
    });
    expect(browserMock.tabs.remove).toHaveBeenCalledWith([1, 2]);
    expect(result.current.closedGroups[0]).toMatchObject({
      key: "tag:lotus",
      pages: expect.arrayContaining([
        expect.objectContaining({ url: "https://drive.google.com/x" }),
      ]),
    });
    expect(local["tabs:closedGroups"]).toBeTruthy();
  });

  it("resumeGroup reopens snapshot + pinned pages that aren't open, skipping open ones", async () => {
    api.resumeGroup.mockResolvedValue({
      pages: [
        { url: "https://drive.google.com/x", title: "Drive" }, // already open → skipped
        { url: "https://notion.so/lotus", title: "Notion" },
      ],
    });
    const { result } = await ready();
    await act(async () => {
      await result.current.resumeGroup("tag:lotus", [
        {
          pinId: "p",
          clipId: "c",
          url: "https://figma.com/lotus",
          key: "https://figma.com/lotus",
          title: "Figma",
        },
      ]);
    });
    expect(browserMock.tabs.create).toHaveBeenCalledTimes(2);
    expect(browserMock.tabs.create).toHaveBeenCalledWith({
      url: "https://notion.so/lotus",
      active: false,
    });
    expect(browserMock.tabs.create).toHaveBeenCalledWith({
      url: "https://figma.com/lotus",
      active: false,
    });
    expect((browserMock.windows as Record<string, unknown>).create).not.toHaveBeenCalled();
  });

  it("resumeGroup opens a new window when more than 8 pages would open", async () => {
    api.resumeGroup.mockResolvedValue({
      pages: Array.from({ length: 10 }, (_, i) => ({
        url: `https://lotus.example/${i}`,
        title: `P${i}`,
      })),
    });
    const { result } = await ready();
    await act(async () => {
      await result.current.resumeGroup("tag:lotus", []);
    });
    const create = (browserMock.windows as Record<string, unknown>).create as ReturnType<
      typeof vi.fn
    >;
    expect(create).toHaveBeenCalledWith({
      url: Array.from({ length: 10 }, (_, i) => `https://lotus.example/${i}`),
    });
    expect(browserMock.tabs.create).not.toHaveBeenCalled();
  });

  it("resumeGroup falls back to the local snapshot when the server has none", async () => {
    api.resumeGroup.mockRejectedValue(new Error("404"));
    local["tabs:closedGroups"] = [
      {
        key: "tag:lotus",
        label: "lotus",
        pages: [{ url: "https://notion.so/lotus", title: "N" }],
        closedAt: "t",
      },
    ];
    const { result } = await ready();
    await waitFor(() => expect(result.current.closedGroups).toHaveLength(1));
    await act(async () => {
      await result.current.resumeGroup("tag:lotus", []);
    });
    expect(browserMock.tabs.create).toHaveBeenCalledWith({
      url: "https://notion.so/lotus",
      active: false,
    });
    expect(result.current.closedGroups).toHaveLength(0);
  });

  it("local-only snapshots are pushed to the server on the next load", async () => {
    local["tabs:closedGroups"] = [
      { key: "tag:x", label: "x", pages: [{ url: "https://x.com/", title: "X" }], closedAt: "t" },
    ];
    const { result } = await ready();
    await waitFor(() =>
      expect(api.closeGroupSnapshot).toHaveBeenCalledWith("tag:x", "x", [
        { url: "https://x.com/", title: "X" },
      ]),
    );
    await waitFor(() => expect(local["tabs:closedGroups"]).toEqual([]));
    expect(result.current.closedGroups.map((g) => g.key)).toEqual(["tag:x"]);
  });

  it("a successful close drops an older local-only snapshot of the same group", async () => {
    local["tabs:closedGroups"] = [
      {
        key: "tag:lotus",
        label: "lotus",
        pages: [{ url: "https://old.com/", title: "Old" }],
        closedAt: "t",
      },
    ];
    api.closeGroupSnapshot.mockRejectedValueOnce(new Error("offline")); // the re-push on load fails
    const { result } = await ready();
    await waitFor(() => expect(api.closeGroupSnapshot).toHaveBeenCalledTimes(1));
    const lotus = result.current.groups.find((g) => g.key === "tag:lotus")!;
    await act(async () => {
      await result.current.closeGroup(lotus);
    });
    expect(local["tabs:closedGroups"]).toEqual([]);
  });

  it("a resume the server didn't confirm is retried, and the group stays gone", async () => {
    const row = {
      key: "tag:lotus",
      label: "lotus",
      pages: [{ url: "https://notion.so/lotus", title: "N" }],
      closedAt: "2026-10-10T10:00:00.000Z",
    };
    api.getClosedGroups.mockResolvedValue({ groups: [row] });
    api.resumeGroup.mockRejectedValueOnce(new Error("Request failed: 500"));
    const first = await ready();
    await waitFor(() => expect(first.result.current.closedGroups).toHaveLength(1));
    await act(async () => {
      await first.result.current.resumeGroup("tag:lotus", []);
    });
    expect(browserMock.tabs.create).toHaveBeenCalledWith({
      url: "https://notion.so/lotus",
      active: false,
    });
    first.unmount();

    api.resumeGroup.mockResolvedValue({ pages: row.pages });
    const second = await ready();
    await waitFor(() => expect(api.resumeGroup).toHaveBeenCalledTimes(2));
    expect(second.result.current.closedGroups).toHaveLength(0);
    expect(browserMock.tabs.create).toHaveBeenCalledTimes(1); // the retry doesn't reopen pages
  });

  it("closing a group again cancels a pending server delete for it", async () => {
    local["tabs:resumePending"] = ["tag:lotus"];
    api.getClosedGroups.mockRejectedValue(new Error("offline"));
    const { result } = await ready();
    const lotus = result.current.groups.find((g) => g.key === "tag:lotus")!;
    await act(async () => {
      await result.current.closeGroup(lotus);
    });
    expect(local["tabs:resumePending"]).toEqual([]);
  });
});
