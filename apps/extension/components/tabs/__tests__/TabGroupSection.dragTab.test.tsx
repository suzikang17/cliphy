// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { TabGroupSection } from "../TabGroupSection";
import type { OpenTab } from "../../../lib/tabs/types";
import type { TabGroup } from "../../../lib/tabs/organize";

const TAB_TYPE = "application/x-cliphy-tab";
const tab = (id: number): OpenTab => ({
  id,
  windowId: 1,
  url: `https://x.com/${id}`,
  title: `Tab ${id}`,
  active: false,
  lastAccessed: id,
  discarded: false,
});
const groupA = {
  key: "tag:a",
  kind: "tag",
  value: "a",
  label: "alpha",
  tabs: [tab(1)],
} as TabGroup;
const groupB = { key: "tag:b", kind: "tag", value: "b", label: "beta", tabs: [tab(5)] } as TabGroup;

function renderBoth(onMove: ReturnType<typeof vi.fn>) {
  const common = {
    collapsed: false,
    onToggle: vi.fn(),
    selectedTabId: null,
    moveTargets: ["tag:a", "tag:b"],
    canStow: true,
    trackingSince: null,
    now: 0,
    onActivate: vi.fn(),
    onMove,
    onSaveHints: vi.fn(),
    onCloseTabs: vi.fn(),
    onStowTabs: vi.fn(),
    onSaveAsTag: vi.fn(),
    onDismiss: vi.fn(),
  };
  render(
    <>
      <TabGroupSection group={groupA} {...common} />
      <TabGroupSection group={groupB} {...common} />
    </>,
  );
}

describe("drag a tab into another group", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — move tabs");
  });
  afterEach(cleanup);

  it("dropping a tab on another group moves it there", () => {
    const onMove = vi.fn();
    renderBoth(onMove);
    const row = screen.getByText("Tab 1").closest("li")!;
    const dt = { setData: vi.fn(), effectAllowed: "", types: [TAB_TYPE], dropEffect: "" };
    fireEvent.dragStart(row, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith(TAB_TYPE, "1");

    const target = screen.getByText("beta").closest("section")!;
    fireEvent.dragOver(target, { dataTransfer: dt });
    expect(screen.getByText(/Move to beta/)).toBeTruthy();
    fireEvent.drop(target, { dataTransfer: dt });
    expect(onMove).toHaveBeenCalledWith(groupA.tabs[0], "tag:b");
    fireEvent.dragEnd(row, { dataTransfer: dt });
  });

  it("dropping a tab back on its own group does nothing", () => {
    const onMove = vi.fn();
    renderBoth(onMove);
    const row = screen.getByText("Tab 1").closest("li")!;
    const dt = { setData: vi.fn(), effectAllowed: "", types: [TAB_TYPE], dropEffect: "" };
    fireEvent.dragStart(row, { dataTransfer: dt });
    const own = screen.getByText("alpha").closest("section")!;
    fireEvent.dragOver(own, { dataTransfer: dt });
    fireEvent.drop(own, { dataTransfer: dt });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.dragEnd(row, { dataTransfer: dt });
  });
});
