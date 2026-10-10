// @vitest-environment jsdom
// The organize request carries "worked on together" clusters as grouping evidence
// (Stripe invoicing + a client's Drive folder share no words but one job).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const NOW = Date.parse("2026-10-10T15:00:00Z");
const organizeMock = vi.fn().mockResolvedValue({ assignments: {}, done: [] });

vi.mock("../../auth", () => ({ isAuthenticated: vi.fn().mockResolvedValue(true) }));
vi.mock("../../api", () => ({
  AuthError: class extends Error {},
  RateLimitError: class extends Error {},
  getTabHints: vi.fn().mockResolvedValue({ hints: {}, keywords: {} }),
  organizeTabs: (...a: unknown[]) => organizeMock(...a),
  putTabHint: vi.fn(),
  stowTab: vi.fn(),
}));
vi.mock("../openedAt", () => ({
  loadOpenedTimes: vi.fn().mockResolvedValue({
    opened: { 41: NOW - 20 * 60_000, 42: NOW - 19 * 60_000, 7: NOW - 5 * 3_600_000 },
    trackingSince: NOW - 86_400_000,
  }),
}));
// Switched between Drive (41) and Stripe (42) six times, a minute apart.
vi.mock("../activity", () => ({
  loadActivity: vi.fn().mockResolvedValue({
    switches: Array.from({ length: 7 }, (_, i) => ({
      tabId: i % 2 ? 42 : 41,
      at: NOW - (10 - i) * 60_000,
    })),
    openers: {},
  }),
}));

const { useTabOrganizer } = await import("../useTabOrganizer");

describe("useTabOrganizer — worked-on-together evidence", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — clusters");
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
    browserMock.permissions.contains.mockResolvedValue(false);
    browserMock.storage.session.get.mockResolvedValue({});
    browserMock.storage.local.get.mockResolvedValue({});
    browserMock.windows.getCurrent.mockResolvedValue({ id: 1 });
    browserMock.tabs.query.mockResolvedValue([
      {
        id: 41,
        windowId: 1,
        url: "https://drive.google.com/x",
        title: "Lotus Bech - Drive",
        lastAccessed: NOW - 120_000,
      },
      {
        id: 42,
        windowId: 1,
        url: "https://dashboard.stripe.com",
        title: "Stripe",
        lastAccessed: NOW - 60_000,
      },
      {
        id: 7,
        windowId: 1,
        url: "https://news.ycombinator.com",
        title: "HN",
        lastAccessed: NOW - 3_600_000,
      },
    ]);
  });

  it("sends the Drive + Stripe cluster with the organize request", async () => {
    renderHook(() => useTabOrganizer());
    await waitFor(() => expect(organizeMock).toHaveBeenCalled());
    const [inputs, clusters] = organizeMock.mock.calls[0];
    expect(inputs.map((t: { key: string }) => t.key).sort()).toEqual(["41", "42", "7"]);
    expect(clusters).toEqual([
      expect.objectContaining({ keys: ["41", "42"], switches: 6, openerLinks: 0 }),
    ]);
  });
});
