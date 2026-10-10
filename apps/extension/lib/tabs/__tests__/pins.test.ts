// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import type { PinnedItem } from "@cliphy/shared";

const api = vi.hoisted(() => ({ getPins: vi.fn(), pinPage: vi.fn(), deletePin: vi.fn() }));
vi.mock("../../api", () => api);
const cache = vi.hoisted(() => ({ readSnapshot: vi.fn(), writeSnapshot: vi.fn() }));
vi.mock("../../newtab-cache", () => cache);

const { pagePinsFrom, usePagePins } = await import("../pins");

const pin = (over: Partial<PinnedItem>): PinnedItem => ({
  id: "p1",
  userId: "u1",
  kind: "clip",
  layout: "tile",
  position: 0,
  clipId: "c1",
  clipUrl: "https://www.a.com/x?utm_source=1",
  clipTitle: "A page",
  pinnedAt: "t",
  updatedAt: "t",
  ...over,
});

describe("page pins", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — pins");
    vi.clearAllMocks();
    cache.readSnapshot.mockResolvedValue(null);
    cache.writeSnapshot.mockResolvedValue(undefined);
    api.getPins.mockResolvedValue({ pins: [pin({})] });
    api.deletePin.mockResolvedValue({ ok: true });
  });

  it("pagePinsFrom carries the clip's tags so Resume can pick a group's pins", () => {
    const [p] = pagePinsFrom([pin({ clipTags: ["freelance:lotus"] })]);
    expect(p.tags).toEqual(["freelance:lotus"]);
  });

  it("pagePinsFrom keeps clip pins with a url, keyed by normalized page", () => {
    const out = pagePinsFrom([
      pin({}),
      pin({
        id: "p2",
        kind: "view",
        clipId: undefined,
        clipUrl: undefined,
        viewQuery: { tags: ["x"] },
      }),
      pin({ id: "p3", clipId: "c3", clipUrl: undefined }),
    ]);
    expect(out).toEqual([
      {
        pinId: "p1",
        clipId: "c1",
        url: "https://www.a.com/x?utm_source=1",
        key: "https://a.com/x",
        title: "A page",
        tags: [],
      },
    ]);
  });

  it("loads pins and matches tracking-param / www variants of a pinned page", async () => {
    const { result } = renderHook(() => usePagePins(true));
    await waitFor(() => expect(result.current.pins).toHaveLength(1));
    expect(result.current.isPinned("https://a.com/x#top")).toBe(true);
    expect(result.current.isPinned("https://a.com/y")).toBe(false);
  });

  it("pin() shows the pin immediately, then keeps the server ids and updates the new-tab snapshot", async () => {
    let resolve!: (v: unknown) => void;
    api.pinPage.mockReturnValue(new Promise((r) => (resolve = r)));
    cache.readSnapshot.mockResolvedValue({ pins: [pin({})], panels: {}, savedAt: 1 });
    const { result } = renderHook(() => usePagePins(true));
    await waitFor(() => expect(result.current.pins).toHaveLength(1));

    let done: Promise<void>;
    act(() => {
      done = result.current.pin({ url: "https://b.com/", title: "B", note: "n" });
    });
    expect(result.current.isPinned("https://b.com")).toBe(true); // optimistic
    expect(api.pinPage).toHaveBeenCalledWith({ url: "https://b.com/", title: "B", note: "n" });

    await act(async () => {
      resolve({
        pin: pin({ id: "p9", clipId: "c9", clipUrl: "https://b.com/" }),
        clip: { id: "c9" },
        created: true,
      });
      await done!;
    });
    expect(result.current.byKey.get("https://b.com/")?.pinId).toBe("p9");
    expect(cache.writeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        pins: expect.arrayContaining([expect.objectContaining({ id: "p9" })]),
      }),
    );
  });

  it("pin() rolls back and reports when the request fails", async () => {
    api.pinPage.mockRejectedValue(new Error("Network"));
    const { result } = renderHook(() => usePagePins(true));
    await waitFor(() => expect(result.current.pins).toHaveLength(1));
    await act(async () => {
      await result.current.pin({ url: "https://b.com/", title: "B" });
    });
    expect(result.current.isPinned("https://b.com/")).toBe(false);
    expect(result.current.error).toMatch(/pin/i);
  });

  it("unpin() removes it at once and offers Undo that re-pins", async () => {
    api.pinPage.mockResolvedValue({ pin: pin({ id: "p1b" }), clip: { id: "c1" }, created: true });
    const { result } = renderHook(() => usePagePins(true));
    await waitFor(() => expect(result.current.pins).toHaveLength(1));
    await act(async () => {
      await result.current.unpin("https://a.com/x");
    });
    expect(result.current.pins).toHaveLength(0);
    expect(api.deletePin).toHaveBeenCalledWith("p1");
    expect(result.current.undo?.text).toMatch(/Unpinned/);
    await act(async () => {
      await result.current.undo!.run();
    });
    expect(api.pinPage).toHaveBeenCalledWith({
      url: "https://www.a.com/x?utm_source=1",
      title: "A page",
    });
    expect(result.current.pins).toHaveLength(1);
  });

  it("loads nothing when signed out", async () => {
    const { result } = renderHook(() => usePagePins(false));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.getPins).not.toHaveBeenCalled();
    expect(result.current.pins).toEqual([]);
  });
});
