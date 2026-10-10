// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { TabGroupSection } from "../TabGroupSection";
import type { OpenTab } from "../../../lib/tabs/types";
import type { TabGroup } from "../../../lib/tabs/organize";

const tab = (id: number): OpenTab => ({
  id,
  windowId: 1,
  url: `https://x.com/${id}`,
  title: `Tab ${id}`,
  active: false,
  lastAccessed: id,
  discarded: false,
});

function renderGroup(group: Partial<TabGroup>, props: Record<string, unknown> = {}) {
  const handlers = {
    onCloseTabs: vi.fn(),
    onStowTabs: vi.fn().mockResolvedValue(2),
    onSaveAsTag: vi.fn().mockResolvedValue(undefined),
    onDismiss: vi.fn(),
  };
  render(
    <TabGroupSection
      group={
        {
          key: "tag:project:lotus-bech",
          kind: "tag",
          value: "project:lotus-bech",
          label: "project › lotus-bech — a long name that should wrap, not truncate",
          tabs: [tab(1), tab(2)],
          ...group,
        } as TabGroup
      }
      collapsed={false}
      onToggle={vi.fn()}
      selectedTabId={null}
      moveTargets={[]}
      canStow
      trackingSince={null}
      now={0}
      onActivate={vi.fn()}
      onMove={vi.fn()}
      onSaveHints={vi.fn()}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("TabGroupSection header (hover-reveal layout)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — layout");
  });
  afterEach(cleanup);

  it("shows the full group name (no truncation class)", () => {
    renderGroup({});
    const name = screen.getByText(/a long name that should wrap/);
    expect(name.className).not.toMatch(/truncate/);
  });

  it("icon actions and the ⋯ menu close and stow the group", async () => {
    const h = renderGroup({});
    fireEvent.click(screen.getByRole("button", { name: /Close all 2 tabs/ }));
    expect(h.onCloseTabs).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(screen.getByRole("button", { name: /Keywords & hints/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Stow all\s*⇧S$/ })); // the menu item
    await vi.waitFor(() => expect(h.onStowTabs).toHaveBeenCalledTimes(1));
  });

  it("actions are revealed (not hidden) when the group holds the selected row", () => {
    renderGroup({}, { selectedTabId: 2 });
    const cluster = screen.getByRole("button", { name: /Close all 2 tabs/ }).parentElement!;
    expect(cluster.className).toMatch(/opacity-100/);
    expect(cluster.className).not.toMatch(/opacity-0/);
  });

  it("a suggested group gets its own line with Save as tag and Dismiss", () => {
    const h = renderGroup({
      key: "proposed:client:brightline",
      kind: "proposed",
      value: "client:brightline",
      label: "client › brightline",
    });
    expect(screen.getByText(/Suggested/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save as tag/ }));
    expect(h.onSaveAsTag).toHaveBeenCalledWith("client:brightline");
    fireEvent.click(screen.getByRole("button", { name: /Dismiss suggested group/ }));
    expect(h.onDismiss).toHaveBeenCalledWith("client:brightline");
  });
});

describe("TabGroupSection drag fade", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — drag");
  });
  afterEach(cleanup);

  it("doesn't stay faded when the drag ends before the deferred fade frame (2026-10-10 bug)", async () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    renderGroup({}, { onReorder: vi.fn() });
    const header = screen.getByText(/a long name/).closest("header")!;
    const section = header.closest("section")!;
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };

    fireEvent.dragStart(header, { dataTransfer });
    fireEvent.dragEnd(header, { dataTransfer }); // ends first…
    act(() => frames.forEach((cb) => cb(0))); // …then the deferred fade frame runs

    expect(section.className).not.toMatch(/opacity-40/);
    raf.mockRestore();
  });
});
