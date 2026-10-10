// @vitest-environment jsdom
// Regression (Dia, 2026-10-10): three windows each have a front tab, and all three
// showed "viewing now". Only the tab in the panel's own window is the one you're on.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

vi.mock("../../auth", () => ({ isAuthenticated: vi.fn().mockResolvedValue(false) }));
vi.mock("../../api", () => ({
  AuthError: class extends Error {},
  RateLimitError: class extends Error {},
  getTabHints: vi.fn(),
  organizeTabs: vi.fn(),
  putTabHint: vi.fn(),
  stowTab: vi.fn(),
}));
vi.mock("../openedAt", () => ({
  loadOpenedTimes: vi.fn().mockResolvedValue({ opened: {}, trackingSince: null }),
}));

const { useTabOrganizer } = await import("../useTabOrganizer");

describe("useTabOrganizer — multiple windows", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — windows");
    vi.clearAllMocks();
    browserMock.permissions.contains.mockResolvedValue(false);
    browserMock.storage.session.get.mockResolvedValue({});
    browserMock.storage.local.get.mockResolvedValue({});
    browserMock.windows.getCurrent.mockResolvedValue({ id: 704 });
    browserMock.tabs.query.mockResolvedValue([
      {
        id: 1,
        windowId: 704,
        url: "https://wecuratelife-mockups.vercel.app/mix",
        title: "Mix",
        active: true,
      },
      { id: 2, windowId: 700, url: "https://dashboard.stripe.com", title: "Stripe", active: true },
      { id: 3, windowId: 702, url: "https://x.com/deedydas", title: "Deedy", active: true },
      { id: 4, windowId: 704, url: "https://typesafe.ai", title: "TypeSafe", active: false },
    ]);
  });

  it("marks only the panel window's front tab active; others are flagged otherWindow", async () => {
    const { result } = renderHook(() => useTabOrganizer());
    await waitFor(() => expect(result.current.tabs).toHaveLength(4));
    const byId = Object.fromEntries(result.current.tabs.map((t) => [t.id, t]));
    expect(byId[1]).toMatchObject({ active: true, otherWindow: false });
    expect(byId[2]).toMatchObject({ active: false, otherWindow: true });
    expect(byId[3]).toMatchObject({ active: false, otherWindow: true });
    expect(byId[4]).toMatchObject({ active: false, otherWindow: false });
  });
});
