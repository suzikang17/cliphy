// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../test/browser-mock";
import { browserMock } from "../../test/browser-mock";
import { isActiveTab } from "../is-active-tab";

describe("isActiveTab", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Active Tab Filtering");
    vi.clearAllMocks();
  });

  it("returns true when tabId matches active tab", async () => {
    browserMock.tabs.query.mockResolvedValue([{ id: 42 }]);
    expect(await isActiveTab(42)).toBe(true);
  });

  it("returns false when tabId does not match active tab", async () => {
    browserMock.tabs.query.mockResolvedValue([{ id: 42 }]);
    expect(await isActiveTab(99)).toBe(false);
  });

  it("returns true when tabId is undefined (background script)", async () => {
    expect(await isActiveTab(undefined)).toBe(true);
  });

  it("returns false when no active tab found", async () => {
    browserMock.tabs.query.mockResolvedValue([]);
    expect(await isActiveTab(42)).toBe(false);
  });
});
