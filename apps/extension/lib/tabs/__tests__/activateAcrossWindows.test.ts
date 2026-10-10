import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import { activateTab } from "../activate";

const tab = (id: number, windowId: number) => ({ id, windowId });

describe("activateTab", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — windows");
    vi.clearAllMocks();
    browserMock.tabs.update.mockResolvedValue(undefined);
    browserMock.windows.update.mockResolvedValue(undefined);
    (browserMock.tabs as Record<string, unknown>).move = vi.fn().mockResolvedValue({});
  });

  it("same window: just activates the tab", async () => {
    await activateTab(tab(5, 1), 1, { settleMs: 0 });
    expect(browserMock.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(browserMock.windows.update).not.toHaveBeenCalled();
  });

  it("other window that the browser focuses (Chrome): switches windows, no move", async () => {
    browserMock.windows.get.mockResolvedValue({ id: 2, focused: true });
    await activateTab(tab(5, 2), 1, { settleMs: 0 });
    expect(browserMock.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(
      (browserMock.tabs as unknown as { move: ReturnType<typeof vi.fn> }).move,
    ).not.toHaveBeenCalled();
  });

  it("other window the browser won't focus (Dia): brings the tab into this window", async () => {
    browserMock.windows.get.mockResolvedValue({ id: 2, focused: false });
    await activateTab(tab(5, 2), 1, { settleMs: 0 });
    expect(
      (browserMock.tabs as unknown as { move: ReturnType<typeof vi.fn> }).move,
    ).toHaveBeenCalledWith(5, {
      windowId: 1,
      index: -1,
    });
    expect(browserMock.tabs.update).toHaveBeenLastCalledWith(5, { active: true });
  });

  it("also moves the tab if focusing the window throws", async () => {
    browserMock.windows.update.mockRejectedValue(new Error("not supported"));
    await activateTab(tab(5, 2), 1, { settleMs: 0 });
    expect(
      (browserMock.tabs as unknown as { move: ReturnType<typeof vi.fn> }).move,
    ).toHaveBeenCalled();
  });
});
