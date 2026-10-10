import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import { registerDupeInterceptor, undoIntercept } from "../interceptDupes";

type Listener = (...args: unknown[]) => unknown;
const lastListener = (l: { addListener: { mock: { calls: unknown[][] } } }) =>
  l.addListener.mock.calls.at(-1)?.[0] as Listener;

const existing = {
  id: 1,
  windowId: 2,
  url: "https://linear.app/i/ENG-1",
  title: "ENG-1",
  active: false,
  lastAccessed: 500,
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("registerDupeInterceptor", () => {
  let onCreated: Listener;
  let onUpdated: Listener;

  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — duplicates");
    vi.clearAllMocks();
    browserMock.storage.local.get.mockResolvedValue({}); // enabled by default
    browserMock.storage.session.get.mockResolvedValue({});
    // Chrome's storage/tabs APIs return promises; the shared mock's bare vi.fn()s don't.
    browserMock.storage.session.set.mockResolvedValue(undefined);
    browserMock.storage.session.remove.mockResolvedValue(undefined);
    browserMock.tabs.remove.mockResolvedValue(undefined);
    browserMock.tabs.create.mockResolvedValue({ id: 99 });
    registerDupeInterceptor();
    onCreated = lastListener(browserMock.tabs.onCreated);
    onUpdated = lastListener(browserMock.tabs.onUpdated);
  });

  it("closes a new foreground duplicate and switches to the existing tab", async () => {
    const fresh = { id: 9, windowId: 1, url: existing.url + "#x", title: "ENG-1", active: true };
    browserMock.tabs.query.mockResolvedValue([existing, fresh]);

    onCreated({ id: 9 });
    onUpdated(9, { url: fresh.url }, fresh);
    await flush();
    await flush();

    expect(browserMock.tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(browserMock.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(browserMock.tabs.remove).toHaveBeenCalledWith(9);
    expect(browserMock.storage.session.set).toHaveBeenCalledWith({
      "tabs:dedupe:last": expect.objectContaining({ url: fresh.url }),
    });
  });

  it("never intercepts navigation of a tab that wasn't just created", async () => {
    const navigated = { id: 5, windowId: 1, url: existing.url, title: "ENG-1", active: true };
    browserMock.tabs.query.mockResolvedValue([existing, navigated]);

    onUpdated(5, { url: navigated.url }, navigated);
    await flush();
    await flush();

    expect(browserMock.tabs.remove).not.toHaveBeenCalled();
  });

  it("respects the off toggle", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "tabs:dedupe:enabled": false });
    const fresh = { id: 9, windowId: 1, url: existing.url, title: "ENG-1", active: true };
    browserMock.tabs.query.mockResolvedValue([existing, fresh]);

    onCreated({ id: 9 });
    onUpdated(9, { url: fresh.url }, fresh);
    await flush();
    await flush();

    expect(browserMock.tabs.remove).not.toHaveBeenCalled();
  });

  it("undo reopens the page and lets it through for a moment", async () => {
    await undoIntercept(existing.url);
    expect(browserMock.storage.session.set).toHaveBeenCalledWith({
      "tabs:dedupe:bypass": [expect.objectContaining({ url: "https://linear.app/i/ENG-1" })],
    });
    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: existing.url });
  });
});
