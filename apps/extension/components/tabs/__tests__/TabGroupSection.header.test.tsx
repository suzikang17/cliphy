// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
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

    fireEvent.click(screen.getByRole("button", { name: /More actions for project/ }));
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

  it("a suggested group gets its own line with Save as tag and Dismiss", async () => {
    const h = renderGroup({
      key: "proposed:client:brightline",
      kind: "proposed",
      value: "client:brightline",
      label: "client › brightline",
    });
    expect(screen.getByText(/Suggested/)).toBeTruthy();
    // Save as tag opens the name (prefilled with the suggestion) before saving.
    fireEvent.click(screen.getByRole("button", { name: /Save as tag/ }));
    const input = screen.getByRole("textbox", { name: "Tag name" }) as HTMLInputElement;
    expect(input.value).toBe("client:brightline");
    fireEvent.submit(input.closest("form")!);
    expect(h.onSaveAsTag).toHaveBeenCalledWith("client:brightline", "client:brightline");
    // The name field closes once the save resolves; Dismiss is back.
    fireEvent.click(await screen.findByRole("button", { name: /Dismiss suggested group/ }));
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

describe("suggested group: reason and rename", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — suggestions");
  });
  afterEach(cleanup);

  const proposed = {
    key: "proposed:project:lotus-bech",
    kind: "proposed" as const,
    value: "project:lotus-bech",
    label: "project › lotus-bech",
  };

  it("shows Claude's reason for grouping", () => {
    renderGroup(proposed, {
      reason: "Project files and client invoicing for Lotus Bech, used together",
    });
    expect(screen.getByText(/Project files and client invoicing/)).toBeTruthy();
  });

  it("saves under the name you type; Escape cancels", () => {
    const h = renderGroup(proposed);
    fireEvent.click(screen.getByRole("button", { name: /Save as tag/ }));
    const input = screen.getByRole("textbox", { name: "Tag name" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Tag name" })).toBeNull();
    expect(h.onSaveAsTag).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Save as tag/ }));
    const again = screen.getByRole("textbox", { name: "Tag name" });
    fireEvent.change(again, { target: { value: "freelance:lotus-bech" } });
    fireEvent.submit(again.closest("form")!);
    expect(h.onSaveAsTag).toHaveBeenCalledWith("project:lotus-bech", "freelance:lotus-bech");
  });
});

describe("TabGroupSection drag start (2026-10-10: upward drags lost the grabber)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — drag");
  });
  afterEach(cleanup);

  it("doesn't collapse the list during dragstart — only a frame later, if still dragging", () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const onDragStateChange = vi.fn();
    renderGroup({}, { onReorder: vi.fn(), onDragStateChange });
    const header = screen.getByText(/a long name/).closest("header")!;
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };

    fireEvent.dragStart(header, { dataTransfer });
    expect(onDragStateChange).not.toHaveBeenCalled(); // nothing moves during dragstart
    act(() => frames.forEach((cb) => cb(0)));
    expect(onDragStateChange).toHaveBeenCalledWith(true);

    // A drag that ends before the frame never collapses anything.
    onDragStateChange.mockClear();
    frames.length = 0;
    fireEvent.dragStart(header, { dataTransfer });
    fireEvent.dragEnd(header, { dataTransfer });
    act(() => frames.forEach((cb) => cb(0)));
    expect(onDragStateChange).not.toHaveBeenCalledWith(true);
    raf.mockRestore();
  });
});

describe("TabGroupSection drag-to-merge", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — merge");
  });
  afterEach(cleanup);

  function dragOverAt(section: HTMLElement, clientY: number) {
    section.getBoundingClientRect = () =>
      ({ top: 100, height: 40, bottom: 140, left: 0, right: 300, width: 300 }) as DOMRect;
    const dataTransfer = {
      types: ["application/x-cliphy-group"],
      getData: () => "tag:ai",
      dropEffect: "",
    };
    // jsdom has no DragEvent, so clientY isn't carried by the init dict — set it directly.
    const event = createEvent.dragOver(section, { dataTransfer });
    Object.defineProperty(event, "clientY", { value: clientY });
    fireEvent(section, event);
    return dataTransfer;
  }

  it("dropping on the middle of a header merges; near its edge still reorders", () => {
    const onMergeInto = vi.fn();
    const onReorder = vi.fn();
    renderGroup({}, { onReorder, onMergeInto });
    const section = screen.getByText(/a long name/).closest("section")!;

    const dt = dragOverAt(section, 120); // middle
    expect(screen.getByText(/Merge into/)).toBeTruthy();
    fireEvent.drop(section, { dataTransfer: dt });
    expect(onMergeInto).toHaveBeenCalledWith("tag:ai", "tag:project:lotus-bech");
    expect(onReorder).not.toHaveBeenCalled();

    const dt2 = dragOverAt(section, 102); // top edge
    fireEvent.drop(section, { dataTransfer: dt2 });
    expect(onReorder).toHaveBeenCalledWith("tag:ai", "tag:project:lotus-bech", "before");
  });

  it("⋯ → Merge into… picks a target", () => {
    const onMergeInto = vi.fn();
    renderGroup(
      {},
      {
        onMergeInto,
        mergeTargets: [
          { key: "tag:design", label: "design", kind: "tag", value: "design", tabs: [] },
        ],
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /More actions for project/ }));
    fireEvent.click(screen.getByRole("button", { name: /Merge into/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /Merge .* into/ }), {
      target: { value: "tag:design" },
    });
    expect(onMergeInto).toHaveBeenCalledWith("tag:project:lotus-bech", "tag:design");
  });
});
