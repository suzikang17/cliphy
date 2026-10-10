import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const captureTrail = vi.fn();
const isAuthenticated = vi.fn();
vi.mock("../../api", () => ({ captureTrail: (...a: unknown[]) => captureTrail(...a) }));
vi.mock("../../auth", () => ({ isAuthenticated: () => isAuthenticated() }));

type Listener = (...args: unknown[]) => unknown;
const lastListener = (l: { addListener: { mock: { calls: unknown[][] } } }) =>
  l.addListener.mock.calls.at(-1)?.[0] as Listener;

const T0 = new Date("2026-10-10T15:00:00").getTime();
const article = "https://example.com/article";

describe("registerTrailTracker", () => {
  let onCreated: Listener;
  let onUpdated: Listener;
  let onRemoved: Listener;
  let openTabs: { id: number; url: string; title: string }[];
  let tracker: typeof import("../tracker");

  /** Open a tab (fresh onCreated → onUpdated with its URL), at T0. */
  const open = (id: number, url: string, title = "Article") => {
    onCreated({ id, url: "" });
    onUpdated(id, { url }, { id, url, title });
    openTabs.push({ id, url, title });
  };
  /** Close a tab `afterMs` from now, then let the close handler finish. */
  const close = async (id: number, afterMs = 60_000) => {
    vi.setSystemTime(Date.now() + afterMs);
    openTabs = openTabs.filter((t) => t.id !== id);
    onRemoved(id, { windowId: 1, isWindowClosing: false });
    await vi.advanceTimersByTimeAsync(0);
  };
  const flushDebounce = () => vi.advanceTimersByTimeAsync(tracker.FLUSH_DEBOUNCE_MS);

  beforeEach(async () => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — trail");
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.resetModules(); // fresh in-memory tracker state per test
    openTabs = [];
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    browserMock.storage.session.get.mockResolvedValue({});
    browserMock.storage.session.set.mockResolvedValue(undefined);
    browserMock.storage.session.remove.mockResolvedValue(undefined);
    browserMock.tabs.query.mockImplementation(async () => openTabs);
    browserMock.runtime.sendMessage.mockResolvedValue(undefined);
    isAuthenticated.mockResolvedValue(true);
    captureTrail.mockResolvedValue({ saved: 1 });

    tracker = await import("../tracker");
    tracker.registerTrailTracker();
    onCreated = lastListener(browserMock.tabs.onCreated);
    onUpdated = lastListener(browserMock.tabs.onUpdated);
    onRemoved = lastListener(browserMock.tabs.onRemoved);
    await vi.advanceTimersByTimeAsync(0); // restore() settles
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues a closed tab and sends it after the debounce", async () => {
    open(1, article, "A good article");
    await close(1);
    expect(captureTrail).not.toHaveBeenCalled(); // closing stays instant

    await flushDebounce();
    expect(captureTrail).toHaveBeenCalledWith([
      { url: article, title: "A good article", openedAt: T0, closedAt: T0 + 60_000 },
    ]);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ type: "TRAIL_SAVED" });
  });

  it("carries your name and note for the page into the trail", async () => {
    browserMock.storage.local.get.mockImplementation(async (key: string) =>
      key === "trail:enabled"
        ? { "trail:enabled": true }
        : key === "tabs:meta:https://example.com/article"
          ? { [key]: { title: "Must-read", note: "share with Ana" } }
          : {},
    );
    open(1, article, "A good article");
    await close(1);
    await flushDebounce();
    expect(captureTrail).toHaveBeenCalledWith([
      expect.objectContaining({ url: article, customTitle: "Must-read", note: "share with Ana" }),
    ]);
  });

  it("does nothing while trail is off (the default)", async () => {
    browserMock.storage.local.get.mockResolvedValue({});
    open(1, article);
    await close(1);
    await flushDebounce();
    expect(captureTrail).not.toHaveBeenCalled();
  });

  it("does nothing when signed out", async () => {
    isAuthenticated.mockResolvedValue(false);
    open(1, article);
    await close(1);
    await flushDebounce();
    expect(captureTrail).not.toHaveBeenCalled();
  });

  it("skips pages the rules reject: searches, sign-in pages, quick peeks", async () => {
    open(1, "https://www.google.com/search?q=cliphy");
    open(2, "https://github.com/login");
    await close(1);
    await close(2);
    open(4, "https://example.com/peek");
    await close(4, 3_000); // open only 3s
    await flushDebounce();
    expect(captureTrail).not.toHaveBeenCalled();
  });

  it("skips a page that's still open in another tab", async () => {
    open(1, article);
    open(2, `${article}#comments`);
    await close(1);
    await flushDebounce();
    expect(captureTrail).not.toHaveBeenCalled();

    await close(2); // the last copy closes → trailed
    await flushDebounce();
    expect(captureTrail).toHaveBeenCalledTimes(1);
    expect(captureTrail.mock.calls[0][0]).toHaveLength(1);
  });

  it("uses the latest URL and title after navigation", async () => {
    open(1, "https://example.com/first", "First");
    onUpdated(1, { url: article }, { id: 1, url: article, title: "Second" });
    openTabs = [{ id: 1, url: article, title: "Second" }];
    await close(1);
    await flushDebounce();
    expect(captureTrail.mock.calls[0][0][0]).toMatchObject({ url: article, title: "Second" });
  });

  it("batches several closes into one request, at most 50 per request", async () => {
    for (let i = 1; i <= 52; i++) open(i, `https://example.com/p/${i}`);
    for (let i = 1; i <= 52; i++) await close(i);
    await flushDebounce();
    expect(captureTrail).toHaveBeenCalledTimes(1);
    expect(captureTrail.mock.calls[0][0]).toHaveLength(50);

    await flushDebounce(); // the overflow goes in the next batch
    expect(captureTrail).toHaveBeenCalledTimes(2);
    expect(captureTrail.mock.calls[1][0]).toHaveLength(2);
  });

  it("retries a failed batch once on the next flush, then drops it — never throws", async () => {
    captureTrail.mockRejectedValue(new Error("offline"));
    open(1, article);
    await close(1);
    await flushDebounce();
    expect(captureTrail).toHaveBeenCalledTimes(1);

    open(2, "https://example.com/other");
    await close(2);
    await flushDebounce();
    expect(captureTrail).toHaveBeenCalledTimes(2);
    expect(captureTrail.mock.calls[1][0].map((i: { url: string }) => i.url)).toEqual([
      article,
      "https://example.com/other",
    ]);

    open(3, "https://example.com/third");
    await close(3);
    await flushDebounce();
    // `article` failed twice → dropped; `other` gets its one retry.
    expect(captureTrail.mock.calls[2][0].map((i: { url: string }) => i.url)).toEqual([
      "https://example.com/other",
      "https://example.com/third",
    ]);
  });

  it("finds a tab's URL from session storage after the worker slept", async () => {
    vi.resetModules();
    browserMock.storage.session.get.mockResolvedValue({
      "trail:tab:7": { url: article, title: "Slept", openedAt: T0 - 600_000 },
    });
    const fresh = await import("../tracker");
    fresh.registerTrailTracker();
    const removed = lastListener(browserMock.tabs.onRemoved);
    removed(7, { windowId: 1, isWindowClosing: false });
    await vi.advanceTimersByTimeAsync(fresh.FLUSH_DEBOUNCE_MS);
    expect(captureTrail).toHaveBeenCalledWith([
      expect.objectContaining({ url: article, title: "Slept", openedAt: T0 - 600_000 }),
    ]);
  });
});
