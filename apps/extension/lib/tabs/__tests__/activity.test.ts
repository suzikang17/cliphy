import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import { appendSwitch, SWITCH_LOG_CAP, SWITCH_LOG_KEY } from "../activity";

type Listener = (...args: unknown[]) => unknown;
const lastListener = (l: { addListener: { mock: { calls: unknown[][] } } }) =>
  l.addListener.mock.calls.at(-1)?.[0] as Listener;
const flush = () => new Promise((r) => setTimeout(r, 0));

const T0 = new Date("2026-10-10T09:00:00").getTime();

describe("appendSwitch", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — clusters");
  });

  it("drops consecutive duplicates", () => {
    const log = appendSwitch([{ tabId: 1, at: T0 }], { tabId: 1, at: T0 + 1000 });
    expect(log).toEqual([{ tabId: 1, at: T0 }]);
    expect(appendSwitch(log, { tabId: 2, at: T0 + 2000 })).toHaveLength(2);
  });

  it("keeps only the last 500 entries", () => {
    let log: { tabId: number; at: number }[] = [];
    for (let i = 0; i < SWITCH_LOG_CAP + 20; i++) {
      log = appendSwitch(log, { tabId: i % 2, at: T0 + i });
    }
    expect(log).toHaveLength(SWITCH_LOG_CAP);
    expect(log[0].at).toBe(T0 + 20);
    expect(log.at(-1)!.at).toBe(T0 + SWITCH_LOG_CAP + 19);
  });
});

describe("registerActivityTracker", () => {
  let store: Record<string, unknown>;
  let mod: typeof import("../activity");
  let onActivated: Listener;
  let onCreated: Listener;
  let onRemoved: Listener;

  beforeEach(async () => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — clusters");
    vi.clearAllMocks();
    vi.resetModules(); // fresh in-memory log per test
    store = {};
    browserMock.storage.session.get.mockImplementation(async (key: string | null) =>
      key === null ? { ...store } : key in store ? { [key]: store[key] } : {},
    );
    browserMock.storage.session.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    });
    browserMock.storage.session.remove.mockImplementation(async (key: string) => {
      delete store[key];
    });
    mod = await import("../activity");
    mod.registerActivityTracker();
    onActivated = lastListener(browserMock.tabs.onActivated);
    onCreated = lastListener(browserMock.tabs.onCreated);
    onRemoved = lastListener(browserMock.tabs.onRemoved);
  });

  it("logs rapid switches in order without clobbering, deduping repeats", async () => {
    vi.spyOn(Date, "now").mockReturnValue(T0);
    onActivated({ tabId: 1, windowId: 1 });
    onActivated({ tabId: 2, windowId: 1 });
    onActivated({ tabId: 2, windowId: 1 });
    onActivated({ tabId: 3, windowId: 1 });
    const { switches } = await mod.loadActivity();
    expect(switches.map((s) => s.tabId)).toEqual([1, 2, 3]);
    expect(browserMock.storage.session.set).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("appends to a log persisted before the worker slept", async () => {
    store[SWITCH_LOG_KEY] = [{ tabId: 7, at: T0 }];
    await mod.recordSwitch(8, T0 + 1000);
    expect(store[SWITCH_LOG_KEY]).toEqual([
      { tabId: 7, at: T0 },
      { tabId: 8, at: T0 + 1000 },
    ]);
  });

  it("stores the opener on create and removes it when the tab closes", async () => {
    onCreated({ id: 5, openerTabId: 4 });
    onCreated({ id: 6 }); // no opener → nothing stored
    await flush();
    expect(store).toEqual({ "tabs:opener:5": 4 });
    expect((await mod.loadActivity()).openers).toEqual({ 5: 4 });

    onRemoved(5);
    expect((await mod.loadActivity()).openers).toEqual({});
  });

  it("never throws when storage fails", async () => {
    browserMock.storage.session.get.mockRejectedValue(new Error("boom"));
    browserMock.storage.session.set.mockRejectedValue(new Error("boom"));
    onActivated({ tabId: 1, windowId: 1 });
    await expect(mod.recordSwitch(2, T0)).resolves.toBeUndefined();
    await expect(mod.loadActivity()).resolves.toEqual({ switches: [], openers: {} });
  });
});
