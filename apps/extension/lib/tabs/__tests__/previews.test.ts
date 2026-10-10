// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import type { OpenTab } from "../types";

const { useTabPreviews, readPreviewImage, PREVIEWS_KEY } = await import("../previews");

let local: Record<string, unknown> = {};
const tab = (id: number, url: string, extra: Partial<OpenTab> = {}): OpenTab =>
  ({
    id,
    windowId: 1,
    url,
    title: url,
    active: false,
    lastAccessed: 1,
    discarded: false,
    ...extra,
  }) as OpenTab;
const scripting = () =>
  (browserMock as unknown as { scripting: { executeScript: ReturnType<typeof vi.fn> } }).scripting;

describe("tab previews (tile view images)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — tiles");
    vi.clearAllMocks();
    local = {};
    browserMock.storage.local.get.mockImplementation(async (k: string) =>
      k in local ? { [k]: local[k] } : {},
    );
    browserMock.storage.local.set.mockImplementation(async (o: Record<string, unknown>) => {
      Object.assign(local, o);
    });
    (browserMock as unknown as { scripting: unknown }).scripting = {
      executeScript: vi.fn(async ({ target }: { target: { tabId: number } }) => [
        { result: target.tabId === 1 ? "https://cdn.a.com/cover.png" : null },
      ]),
    };
  });

  it("reads each tab's preview image once and remembers it on this browser", async () => {
    const tabs = [tab(1, "https://a.com/x"), tab(2, "https://b.com/y")];
    const { result } = renderHook(() => useTabPreviews(tabs, true));
    await waitFor(() =>
      expect(result.current["https://a.com/x"]).toBe("https://cdn.a.com/cover.png"),
    );
    expect(result.current["https://b.com/y"]).toBeUndefined();
    expect(Object.keys(local[PREVIEWS_KEY] as object)).toEqual(
      expect.arrayContaining(["https://a.com/x", "https://b.com/y"]), // "no image" is remembered too
    );
    renderHook(() => useTabPreviews(tabs, true));
    await waitFor(() => expect(scripting().executeScript).toHaveBeenCalledTimes(2)); // not again
  });

  it("does nothing while the tile view is off, and skips sleeping tabs", async () => {
    renderHook(() => useTabPreviews([tab(1, "https://a.com/x")], false));
    renderHook(() => useTabPreviews([tab(3, "https://c.com/", { discarded: true })], true));
    await new Promise((r) => setTimeout(r, 20));
    expect(scripting().executeScript).not.toHaveBeenCalled();
  });

  it("a tab that never answers doesn't block the others", async () => {
    scripting().executeScript.mockImplementation(
      async ({ target }: { target: { tabId: number } }) =>
        target.tabId === 1 ? new Promise(() => {}) : [{ result: "https://cdn.b.com/b.png" }],
    );
    const tabs = [tab(1, "https://a.com/x"), tab(2, "https://b.com/y")];
    const { result } = renderHook(() => useTabPreviews(tabs, true));
    await waitFor(() => expect(result.current["https://b.com/y"]).toBe("https://cdn.b.com/b.png"), {
      timeout: 4000,
    });
  });

  it("readPreviewImage returns og:image as an absolute web URL, else null", () => {
    document.head.innerHTML = `<meta property="og:image" content="/c.png">`;
    expect(readPreviewImage()).toBe(new URL("/c.png", location.href).href);
    document.head.innerHTML = "";
    expect(readPreviewImage()).toBeNull();
  });
});
