// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import type { OpenTab } from "../../../lib/tabs/types";
import type { TabGroup } from "../../../lib/tabs/organize";

const tab = (id: number, url: string, title: string): OpenTab => ({
  id,
  windowId: 1,
  url,
  title,
  active: false,
  lastAccessed: 1000 - id,
  discarded: false,
});
const a1 = tab(1, "https://a.com/1", "A one");
const a2 = tab(2, "https://a.com/2", "A two");
const b1 = tab(3, "https://notion.so/x", "Brightline brief");
const groups: TabGroup[] = [
  { key: "site:a.com", kind: "site", value: "a.com", label: "a.com", tabs: [a1, a2] },
  {
    key: "proposed:client:brightline",
    kind: "proposed",
    value: "client:brightline",
    label: "client › brightline",
    tabs: [b1],
  },
] as TabGroup[];

const org = {
  tabs: [a1, a2, b1],
  groups,
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
vi.mock("../../../lib/tabs/groupNotes", () => ({
  useGroupNotes: () => ({ notes: {}, save: vi.fn(), error: null }),
}));
const pagePins = {
  pins: [],
  byKey: new Map(),
  isPinned: (() => false) as (url: string) => boolean,
  pin: vi.fn(),
  unpin: vi.fn(),
  undo: null,
  error: null,
};
// A fresh object per render, like the real hook — catches handlers holding an old one.
vi.mock("../../../lib/tabs/pins", () => ({ usePagePins: () => ({ ...pagePins }) }));

// jsdom has no layout, so no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const { TabsView } = await import("../TabsView");
const press = (key: string, target: Element | Document = document.body) =>
  act(() => {
    fireEvent.keyDown(target, { key });
  });

describe("TabsView keyboard shortcuts", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — shortcuts");
    vi.clearAllMocks();
    browserMock.storage.local.get.mockResolvedValue({});
    (browserMock.commands as Record<string, unknown>).getAll = vi.fn().mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("j/k select rows, Enter opens, x closes the selected tab", async () => {
    render(<TabsView />);
    (document.activeElement as HTMLElement)?.blur(); // search autofocuses
    await press("j");
    await press("j");
    await press("Enter");
    expect(org.activate).toHaveBeenCalledWith(a2);
    await press("k");
    await press("x");
    expect(org.closeTabs).toHaveBeenCalledWith([a1.id]);
  });

  it("p pins the selected tab with its url and title", async () => {
    render(<TabsView />);
    (document.activeElement as HTMLElement)?.blur();
    await press("j");
    await press("p");
    expect(pagePins.pin).toHaveBeenCalledWith({ url: a1.url, title: a1.title });
  });

  it("p unpins a tab that became pinned after the panel mounted", async () => {
    const { rerender } = render(<TabsView />);
    pagePins.isPinned = (url) => url === a1.url; // pins arrive from the server
    rerender(<TabsView />);
    (document.activeElement as HTMLElement)?.blur();
    await press("j");
    await press("p");
    expect(pagePins.unpin).toHaveBeenCalledWith(a1.url);
    expect(pagePins.pin).not.toHaveBeenCalled();
    pagePins.isPinned = () => false;
  });

  it("List / Tiles switches how groups show, remembers it, and v toggles it", async () => {
    browserMock.storage.local.set.mockResolvedValue(undefined);
    render(<TabsView />);
    expect(document.querySelectorAll("li[data-tile]")).toHaveLength(0); // list by default
    fireEvent.click(screen.getByRole("button", { name: "Tiles" }));
    expect(document.querySelectorAll("li[data-tile]").length).toBeGreaterThan(0);
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ "tabs:view": "tiles" });
    (document.activeElement as HTMLElement)?.blur();
    await press("v");
    expect(document.querySelectorAll("li[data-tile]")).toHaveLength(0);
  });

  it("does nothing while typing in the search box", async () => {
    render(<TabsView />);
    const search = screen.getByRole("searchbox");
    await press("x", search);
    expect(org.closeTabs).not.toHaveBeenCalled();
  });

  it("group keys act on the selected row's group: ⇧X closes it, a saves a suggestion as a tag", async () => {
    render(<TabsView />);
    (document.activeElement as HTMLElement)?.blur();
    await press("j"); // a1 (site:a.com)
    await press("X");
    expect(org.closeTabs).toHaveBeenCalledWith([a1.id, a2.id]);
    await press("j");
    await press("j"); // b1 (proposed)
    await press("a");
    expect(org.saveAsTag).toHaveBeenCalledWith("client:brightline");
  });

  it("⇧C closes the selected row's group, keeping it to resume", async () => {
    render(<TabsView />);
    (document.activeElement as HTMLElement)?.blur();
    await press("j"); // a1 (site:a.com)
    await press("C");
    expect(org.closeGroup).toHaveBeenCalledWith(expect.objectContaining({ key: "site:a.com" }));
  });

  it("⇧W and the header button stow stale tabs (untouched 3+ days), oldest first", async () => {
    render(<TabsView />);
    (document.activeElement as HTMLElement)?.blur();
    await press("W");
    expect(org.stowTabs).toHaveBeenCalledWith([b1, a2, a1]);
    org.stowTabs.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Stow stale \(3\)/ }));
    expect(org.stowTabs).toHaveBeenCalledWith([b1, a2, a1]);
  });

  it("shortcut labels appear only while the modifier is held", async () => {
    const { LABEL_MODIFIER } = await import("../../../lib/tabs/shortcuts");
    render(<TabsView />);
    expect(screen.queryAllByText("⇧X")).toHaveLength(0);
    await act(() => {
      fireEvent.keyDown(document, { key: LABEL_MODIFIER });
    });
    expect(screen.getAllByText("⇧X").length).toBeGreaterThan(0); // Close all label
    await act(() => {
      fireEvent.keyUp(document, { key: LABEL_MODIFIER });
    });
    expect(screen.queryAllByText("⇧X")).toHaveLength(0);
    // Releasing ⌘ outside the panel: blur clears them too.
    await act(() => {
      fireEvent.keyDown(document, { key: LABEL_MODIFIER });
      window.dispatchEvent(new Event("blur"));
    });
    expect(screen.queryAllByText("⇧X")).toHaveLength(0);
  });

  it("? opens the cheat sheet and Esc closes it", async () => {
    render(<TabsView />);
    (document.activeElement as HTMLElement)?.blur();
    await press("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    await press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("/ focuses search", async () => {
    render(<TabsView />);
    (document.activeElement as HTMLElement)?.blur();
    await press("/");
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });
});
