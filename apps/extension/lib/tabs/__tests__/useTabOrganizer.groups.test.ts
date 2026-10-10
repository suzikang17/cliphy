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

let open: typeof tabs = [];

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
    open = [...tabs];
    browserMock.tabs.query.mockImplementation(async () => open);
    browserMock.tabs.remove.mockImplementation(async (ids: number | number[]) => {
      const drop = new Set(Array.isArray(ids) ? ids : [ids]);
      open = open.filter((t) => !drop.has(t.id));
    });
    browserMock.tabs.create.mockResolvedValue({ id: 9 });
    api.getClosedGroups.mockResolvedValue({ groups: [] });
    api.closeGroupSnapshot.mockResolvedValue({ closedAt: "2026-10-10T10:00:00.000Z" });
  });

  async function ready() {
    const h = renderHook(() => useTabOrganizer());
    await waitFor(() => expect(h.result.current.groups.map((g) => g.key)).toContain("tag:lotus"));
    return h;
  }

  const snap = (key: string, urls: string[], extra: Record<string, unknown> = {}) => ({
    key,
    label: key.slice(4),
    pages: urls.map((url) => ({ url, title: url })),
    updatedAt: Date.parse("2026-10-10T09:00:00Z"),
    ...extra,
  });

  it("autosaves open tag groups, locally and to the server", async () => {
    await ready();
    await waitFor(() =>
      expect((local["tabs:groupSnapshots"] as Record<string, unknown>)?.["tag:lotus"]).toBeTruthy(),
    );
    await waitFor(
      () =>
        expect(api.closeGroupSnapshot).toHaveBeenCalledWith("tag:lotus", "lotus", [
          { url: "https://drive.google.com/x", title: "Drive" },
          { url: "https://dashboard.stripe.com/", title: "Stripe" },
        ]),
      { timeout: 3000 },
    );
  });

  it("⇧C closes the tabs and keeps the group to resume, even when the server is down", async () => {
    api.closeGroupSnapshot.mockRejectedValue(new Error("offline"));
    const { result } = await ready();
    const lotus = result.current.groups.find((g) => g.key === "tag:lotus")!;
    await act(async () => {
      await result.current.closeGroup(lotus);
    });
    expect(browserMock.tabs.remove).toHaveBeenCalledWith([1, 2]);
    await waitFor(() =>
      expect(result.current.closedGroups.map((g) => g.key)).toEqual(["tag:lotus"]),
    );
    const saved = (local["tabs:groupSnapshots"] as Record<string, { closedAt?: number }>)[
      "tag:lotus"
    ];
    expect(saved.closedAt).toBeTypeOf("number");
  });

  it("a group whose tabs vanished (browser quit, not restored) shows up as closed", async () => {
    local["tabs:groupSnapshots"] = {
      "tag:gone": snap("tag:gone", ["https://gone.com/a", "https://gone.com/b"]),
    };
    const { result } = await ready();
    await waitFor(() =>
      expect(result.current.closedGroups.map((g) => g.key)).toEqual(["tag:gone"]),
    );
  });

  it("groups saved on another device show up too", async () => {
    api.getClosedGroups.mockResolvedValue({
      groups: [
        {
          key: "tag:far",
          label: "far",
          pages: [{ url: "https://far.com/", title: "Far" }],
          closedAt: "2026-10-10T08:00:00.000Z",
        },
      ],
    });
    const { result } = await ready();
    await waitFor(() => expect(result.current.closedGroups.map((g) => g.key)).toEqual(["tag:far"]));
  });

  it("resumeGroup reopens the snapshot + the group's pins, skipping pages already open", async () => {
    local["tabs:groupSnapshots"] = {
      "tag:gone": snap("tag:gone", ["https://drive.google.com/x", "https://notion.so/lotus"], {
        closedAt: Date.parse("2026-10-10T09:30:00Z"),
      }),
    };
    const { result } = await ready();
    await act(async () => {
      await result.current.resumeGroup("tag:gone", [
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
    expect(api.resumeGroup).not.toHaveBeenCalled(); // the snapshot lives on; autosave keeps it current
    const saved = (local["tabs:groupSnapshots"] as Record<string, { closedAt?: number }>)[
      "tag:gone"
    ];
    expect(saved.closedAt).toBeUndefined();
  });

  it("resumeGroup opens a new window when more than 8 pages would open", async () => {
    local["tabs:groupSnapshots"] = {
      "tag:big": snap(
        "tag:big",
        Array.from({ length: 10 }, (_, i) => `https://lotus.example/${i}`),
      ),
    };
    const { result } = await ready();
    await act(async () => {
      await result.current.resumeGroup("tag:big", []);
    });
    const create = (browserMock.windows as Record<string, unknown>).create as ReturnType<
      typeof vi.fn
    >;
    expect(create).toHaveBeenCalledWith({
      url: Array.from({ length: 10 }, (_, i) => `https://lotus.example/${i}`),
    });
    expect(browserMock.tabs.create).not.toHaveBeenCalled();
  });

  it("forgetGroup removes a closed group here and on the server", async () => {
    local["tabs:groupSnapshots"] = { "tag:gone": snap("tag:gone", ["https://gone.com/a"]) };
    api.resumeGroup.mockResolvedValue({ pages: [] });
    const { result } = await ready();
    await waitFor(() => expect(result.current.closedGroups).toHaveLength(1));
    await act(async () => {
      await result.current.forgetGroup("tag:gone");
    });
    expect(result.current.closedGroups).toHaveLength(0);
    expect((local["tabs:groupSnapshots"] as Record<string, unknown>)["tag:gone"]).toBeUndefined();
    expect(api.resumeGroup).toHaveBeenCalledWith("tag:gone");
  });

  it("placeUrl puts a page into a group before it's open (restore into a group)", async () => {
    const { result } = await ready();
    await act(async () => {
      await result.current.placeUrl("https://other.com/", "tag:lotus");
    });
    await waitFor(() =>
      expect(
        result.current.groups.find((g) => g.key === "tag:lotus")!.tabs.map((t) => t.id),
      ).toContain(3),
    );
  });

  it("a tab that never answers the page read (asleep / still loading) doesn't stall organizing", async () => {
    browserMock.permissions.contains.mockResolvedValue(true); // page content granted
    (browserMock as unknown as { scripting: { executeScript: unknown } }).scripting = {
      executeScript: vi.fn(() => new Promise(() => {})), // never settles
    };
    const { organizeTabs } = await import("../../api");
    const { result } = renderHook(() => useTabOrganizer());
    await waitFor(() => expect(organizeTabs).toHaveBeenCalled(), { timeout: 5000 });
    await waitFor(() => expect(result.current.status).not.toBe("organizing"));
  }, 10_000);

  it("save status: a tag group shows Saved once the server has it, and which pages are in it", async () => {
    const { result } = await ready();
    await waitFor(() => expect(result.current.saveStatus["tag:lotus"]).toBe("saved"), {
      timeout: 4000,
    });
    expect([...result.current.savedPages["tag:lotus"]]).toEqual(
      expect.arrayContaining(["https://drive.google.com/x", "https://dashboard.stripe.com/"]),
    );
  });

  it("save status: server unreachable → saved on this device only", async () => {
    api.closeGroupSnapshot.mockRejectedValue(new Error("offline"));
    const { result } = await ready();
    await waitFor(() => expect(result.current.saveStatus["tag:lotus"]).toBe("local"), {
      timeout: 4000,
    });
  });

  it("saveGroupNow saves a group to the server right away", async () => {
    const { result } = await ready();
    const lotus = result.current.groups.find((g) => g.key === "tag:lotus")!;
    api.closeGroupSnapshot.mockClear();
    await act(async () => {
      await result.current.saveGroupNow(lotus);
    });
    expect(api.closeGroupSnapshot).toHaveBeenCalledWith("tag:lotus", "lotus", expect.any(Array));
    expect(result.current.saveStatus["tag:lotus"]).toBe("saved");
  });

  it("a saved group keeps pages whose tabs you closed, listed as not open", async () => {
    local["tabs:groupSnapshots"] = {
      "tag:lotus": snap("tag:lotus", [
        "https://drive.google.com/x",
        "https://dashboard.stripe.com/",
        "https://notion.so/lotus",
      ]),
    };
    const { result } = await ready();
    await waitFor(() =>
      expect(result.current.notOpen["tag:lotus"]?.map((p) => p.url)).toEqual([
        "https://notion.so/lotus",
      ]),
    );
  });

  it("openSavedPage reopens a saved page into its group; removeFromGroup takes it out", async () => {
    local["tabs:groupSnapshots"] = {
      "tag:lotus": snap("tag:lotus", ["https://drive.google.com/x", "https://notion.so/lotus"]),
    };
    const { result } = await ready();
    await act(async () => {
      await result.current.openSavedPage("tag:lotus", {
        url: "https://notion.so/lotus",
        title: "N",
      });
    });
    expect(browserMock.tabs.create).toHaveBeenCalledWith({
      url: "https://notion.so/lotus",
      active: true,
    });
    expect(local["tabs:override:https://notion.so/lotus"]).toBe("tag:lotus");

    await act(async () => {
      await result.current.removeFromGroup("tag:lotus", "https://notion.so/lotus");
    });
    const saved = (local["tabs:groupSnapshots"] as Record<string, { pages: { url: string }[] }>)[
      "tag:lotus"
    ];
    expect(saved.pages.map((p) => p.url)).not.toContain("https://notion.so/lotus");
    expect(saved.pages.map((p) => p.url)).toContain("https://drive.google.com/x");
  });
});
