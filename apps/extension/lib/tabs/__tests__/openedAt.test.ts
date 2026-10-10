import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import {
  formatAgo,
  tabTimesLabel,
  recordOpened,
  forgetOpened,
  ensureTrackingSince,
  loadOpenedTimes,
  TRACKING_SINCE_KEY,
} from "../openedAt";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-10T15:00:00").getTime();

describe("openedAt", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
    vi.clearAllMocks();
  });

  describe("formatAgo", () => {
    it.each([
      [0, "just now"],
      [59_000, "just now"],
      [5 * MIN, "5m ago"],
      [2 * HOUR + 10 * MIN, "2h ago"],
      [3 * DAY + HOUR, "3d ago"],
      [45 * DAY, "6w ago"],
    ])("%i ms → %s", (delta, expected) => {
      expect(formatAgo(NOW - delta, NOW)).toBe(expected);
    });

    it("clamps future timestamps to just now", () => {
      expect(formatAgo(NOW + 5000, NOW)).toBe("just now");
    });
  });

  describe("tabTimesLabel", () => {
    it("shows opened and viewed", () => {
      expect(
        tabTimesLabel({
          openedAt: NOW - 3 * DAY,
          trackingSince: NOW - 10 * DAY,
          lastAccessed: NOW - 2 * HOUR,
          active: false,
          now: NOW,
        }),
      ).toBe("opened 3d ago · viewed 2h ago");
    });

    it("says viewing now for the active tab", () => {
      expect(
        tabTimesLabel({
          openedAt: NOW - 5 * MIN,
          trackingSince: NOW - DAY,
          lastAccessed: NOW,
          active: true,
          now: NOW,
        }),
      ).toBe("opened 5m ago · viewing now");
    });

    it("falls back to 'open since before <time>' when the open time is unknown", () => {
      const label = tabTimesLabel({
        openedAt: undefined,
        trackingSince: new Date("2026-10-10T09:14:00").getTime(),
        lastAccessed: NOW - HOUR,
        active: false,
        now: NOW,
      });
      expect(label).toMatch(/^open since before 9:14\s?AM · viewed 1h ago$/i);
    });

    it("omits the open part entirely when nothing is known, and viewed when Chrome didn't report it", () => {
      expect(
        tabTimesLabel({
          openedAt: undefined,
          trackingSince: null,
          lastAccessed: 0,
          active: false,
          now: NOW,
        }),
      ).toBe("");
    });
  });

  describe("tracker storage", () => {
    it("records and forgets per-tab open times in storage.session", async () => {
      await recordOpened(42, NOW);
      expect(browserMock.storage.session.set).toHaveBeenCalledWith({ "tabs:opened:42": NOW });
      await forgetOpened(42);
      expect(browserMock.storage.session.remove).toHaveBeenCalledWith("tabs:opened:42");
    });

    it("sets trackingSince only once per browser session", async () => {
      browserMock.storage.session.get.mockResolvedValueOnce({});
      await ensureTrackingSince(NOW);
      expect(browserMock.storage.session.set).toHaveBeenCalledWith({ [TRACKING_SINCE_KEY]: NOW });

      vi.clearAllMocks();
      browserMock.storage.session.get.mockResolvedValueOnce({ [TRACKING_SINCE_KEY]: NOW - DAY });
      await ensureTrackingSince(NOW);
      expect(browserMock.storage.session.set).not.toHaveBeenCalled();
    });

    it("loads open times keyed by tab id plus trackingSince", async () => {
      browserMock.storage.session.get.mockResolvedValueOnce({
        "tabs:opened:1": NOW - DAY,
        "tabs:opened:7": NOW - HOUR,
        [TRACKING_SINCE_KEY]: NOW - 2 * DAY,
        "tabs:assign:https://x.com": { tag: "t" },
      });
      expect(await loadOpenedTimes()).toEqual({
        opened: { 1: NOW - DAY, 7: NOW - HOUR },
        trackingSince: NOW - 2 * DAY,
      });
    });
  });
});
