// @vitest-environment jsdom
// Regression: peeking at a "Probably done" tab from the panel must not pull it out
// of the group, so "Close all" closes it too — and you land on the next tab.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const DONE_URL = "https://www.google.com/search?q=x";
const clearDoneMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../auth", () => ({ isAuthenticated: vi.fn().mockResolvedValue(false) }));
vi.mock("../../api", () => ({
  AuthError: class extends Error {},
  RateLimitError: class extends Error {},
  getTabHints: vi.fn(),
  organizeTabs: vi.fn(),
  putTabHint: vi.fn(),
  stowTab: vi.fn(),
}));
vi.mock("../cache", async (orig) => ({
  ...(await orig<typeof import("../cache")>()),
  loadOrganizerState: vi.fn(async () => ({
    assignments: {},
    done: new Set([DONE_URL]),
    overrides: {},
    dismissed: new Set(),
  })),
  clearDone: (url: string) => clearDoneMock(url),
}));
vi.mock("../openedAt", () => ({
  loadOpenedTimes: vi.fn().mockResolvedValue({ opened: {}, trackingSince: null }),
}));

const { useTabOrganizer } = await import("../useTabOrganizer");

type Listener = (...args: unknown[]) => unknown;
const lastListener = (l: { addListener: { mock: { calls: unknown[][] } } }) =>
  l.addListener.mock.calls.at(-1)?.[0] as Listener;

// Window strip: [1 normal] [2 done, the one you peek at] [3 normal]
const chromeTabs = [
  { id: 1, windowId: 7, index: 0, url: "https://a.com", title: "A", active: false },
  { id: 2, windowId: 7, index: 1, url: DONE_URL, title: "x - Google", active: false },
  { id: 3, windowId: 7, index: 2, url: "https://c.com", title: "C", active: false },
];

describe("useTabOrganizer — peeking at a done tab", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
    vi.clearAllMocks();
    browserMock.permissions.contains.mockResolvedValue(false);
    browserMock.tabs.update.mockResolvedValue(undefined);
    browserMock.tabs.remove.mockResolvedValue(undefined);
    browserMock.windows.update.mockResolvedValue(undefined);
    browserMock.tabs.query.mockImplementation(async (q: Record<string, unknown> = {}) => {
      if (q.active)
        return chromeTabs.filter((t) => t.id === 2).map((t) => ({ ...t, active: true }));
      return chromeTabs;
    });
  });

  it("keeps the peeked tab in Probably done, closes it with the group, and moves to the next tab", async () => {
    const { result } = renderHook(() => useTabOrganizer());
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));
    const doneGroup = () => result.current.groups.find((g) => g.kind === "done");
    expect(doneGroup()?.tabs.map((t) => t.id)).toEqual([2]);

    const onActivated = lastListener(browserMock.tabs.onActivated);
    const peeked = result.current.tabs.find((t) => t.id === 2)!;

    // Click the row to see what it is → the panel switches to it.
    await act(async () => {
      await result.current.activate(peeked);
      await onActivated({ tabId: 2, windowId: 7 });
    });

    expect(clearDoneMock).not.toHaveBeenCalled();
    expect(doneGroup()?.tabs.map((t) => t.id)).toEqual([2]);

    // Close all in Probably done → the tab you're on closes, and you land on the next one.
    await act(async () => {
      await result.current.closeTabs(doneGroup()!.tabs.map((t) => t.id));
    });
    expect(browserMock.tabs.update).toHaveBeenLastCalledWith(3, { active: true });
    expect(browserMock.tabs.remove).toHaveBeenCalledWith([2]);
  });

  it("switching to a done tab yourself (outside the panel) still clears it", async () => {
    const { result } = renderHook(() => useTabOrganizer());
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));
    const onActivated = lastListener(browserMock.tabs.onActivated);

    await act(async () => {
      await onActivated({ tabId: 2, windowId: 7 });
    });

    expect(clearDoneMock).toHaveBeenCalledWith(DONE_URL);
  });
});
