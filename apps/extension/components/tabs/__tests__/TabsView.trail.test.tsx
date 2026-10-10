// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import type { TrailItem } from "@cliphy/shared";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import type { OpenTab } from "../../../lib/tabs/types";
import type { TabGroup } from "../../../lib/tabs/organize";

const a1: OpenTab = {
  id: 1,
  windowId: 1,
  url: "https://a.com/1",
  title: "A one",
  active: false,
  lastAccessed: 900,
  discarded: false,
};
const org = {
  tabs: [a1],
  groups: [
    { key: "site:a.com", kind: "site", value: "a.com", label: "a.com", tabs: [a1] },
  ] as TabGroup[],
  hints: {},
  keywords: {},
  proposalKeywords: {},
  proposalReasons: {},
  knownTags: [],
  authed: true,
  status: "idle",
  contentGranted: true,
  trackingSince: null,
  hasManualOrder: false,
  activate: vi.fn(),
  closeTabs: vi.fn(),
  closedGroups: [],
  saveStatus: {},
  savedPages: {},
  saveGroupNow: vi.fn(),
  notOpen: {},
  openSavedPage: vi.fn(),
  removeFromGroup: vi.fn(),
  closeGroup: vi.fn(),
  resumeGroup: vi.fn(),
  stowTabs: vi.fn().mockResolvedValue(1),
  moveTo: vi.fn(),
  saveAsTag: vi.fn(),
  saveHints: vi.fn(),
  dismissProposal: vi.fn(),
  reorder: vi.fn(),
  nudge: vi.fn(),
  resetOrder: vi.fn(),
  retry: vi.fn(),
  requestContent: vi.fn(),
};
vi.mock("../../../lib/tabs/useTabOrganizer", () => ({ useTabOrganizer: () => org }));
vi.mock("../DuplicatesPanel", () => ({ DuplicatesPanel: () => null }));

const closed = (id: string, title: string): TrailItem => ({
  id,
  url: `https://closed.com/${id}`,
  title,
  host: "closed.com",
  tags: [],
  closedAt: new Date().toISOString(),
  closeCount: 1,
});
const c1 = closed("c1", "Closed one");
const c2 = closed("c2", "Closed two");
const c3 = closed("c3", "Closed three");

const api = vi.hoisted(() => ({
  listTrail: vi.fn(),
  deleteTrailItem: vi.fn(),
  promoteTrailItem: vi.fn(),
  getTrailSettings: vi.fn(),
  putTrailSettings: vi.fn(),
  captureTrail: vi.fn(),
  getPins: vi.fn().mockResolvedValue({ pins: [] }),
  getGroupNotes: vi.fn().mockResolvedValue({ notes: {} }),
  putGroupNote: vi.fn(),
  pinPage: vi.fn(),
  deletePin: vi.fn(),
}));
vi.mock("../../../lib/api", () => api);

Element.prototype.scrollIntoView = vi.fn();

const { TabsView } = await import("../TabsView");
const press = (key: string) =>
  act(() => {
    fireEvent.keyDown(document.body, { key });
  });

describe("TabsView — recently closed shortcuts", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — trail");
    vi.clearAllMocks();
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    browserMock.tabs.create.mockResolvedValue({ id: 9 });
    api.listTrail.mockResolvedValue({ items: [c1, c2, c3] });
    api.getTrailSettings.mockResolvedValue({ retentionDays: null });
    api.deleteTrailItem.mockResolvedValue({ deleted: true });
    api.promoteTrailItem.mockResolvedValue({ clip: { id: "x" }, tags: [] });
  });
  afterEach(cleanup);

  it("j walks from open tabs into closed ones; Enter reopens, x removes, s saves", async () => {
    render(<TabsView />);
    await screen.findByText("Closed one");
    (document.activeElement as HTMLElement)?.blur();

    await press("j"); // a1
    await press("j"); // c1
    await press("Enter");
    expect(org.activate).not.toHaveBeenCalled();
    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: c1.url });

    // c1 left the list, so the selection now sits on c2.
    await press("x");
    expect(api.deleteTrailItem).toHaveBeenCalledWith("c2");

    await press("s"); // now c3
    expect(api.promoteTrailItem).toHaveBeenCalledWith("c3");
  });
});
