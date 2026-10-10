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

describe("TabGroupSection — group note", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — group notes");
  });
  afterEach(cleanup);

  it("shows the group's note and edits it from the ⋯ menu", () => {
    const onSaveNote = vi.fn();
    renderGroup({}, { note: "invoice due Fri", onSaveNote });
    expect(screen.getByText(/invoice due Fri/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /More actions for project/ }));
    fireEvent.click(screen.getByRole("button", { name: /Edit note/ }));
    const box = screen.getByRole("textbox", { name: /Note for project/ });
    fireEvent.change(box, { target: { value: "paid ✓" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onSaveNote).toHaveBeenCalledWith("project:lotus-bech", "paid ✓");
  });

  it("⌘/Ctrl+Enter saves", () => {
    const onSaveNote = vi.fn();
    renderGroup({}, { onSaveNote, noteNonce: 1 });
    const box = screen.getByRole("textbox", { name: /Note for project/ });
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSaveNote).toHaveBeenCalledWith("project:lotus-bech", "line one");
  });

  it("Esc cancels (the N shortcut opens the editor)", () => {
    const onSaveNote = vi.fn();
    renderGroup({}, { onSaveNote, noteNonce: 1 }); // N shortcut opens the editor
    const box = screen.getByRole("textbox", { name: /Note for project/ });
    fireEvent.change(box, { target: { value: "draft" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /Note for project/ })).toBeNull();
    expect(onSaveNote).not.toHaveBeenCalled();
  });

  it("site groups don't offer notes", () => {
    renderGroup(
      { key: "site:x.com", kind: "site", value: "x.com", label: "x.com" },
      { onSaveNote: vi.fn() },
    );
    fireEvent.click(screen.getByRole("button", { name: /More actions for x.com/ }));
    expect(screen.queryByRole("button", { name: /note/i })).toBeNull();
  });
});

describe("TabGroupSection — tile view", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — tiles");
  });
  afterEach(cleanup);

  it("renders the group's tabs as tiles, with preview images where known", () => {
    renderGroup({}, { view: "tiles", previews: { "https://x.com/1": "https://cdn.x.com/1.png" } });
    expect(document.querySelectorAll("li[data-tile]")).toHaveLength(2);
    expect((document.querySelector("img[data-preview]") as HTMLImageElement).src).toBe(
      "https://cdn.x.com/1.png",
    );
  });
});

describe("TabGroupSection — saved summaries", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — saved in groups");
  });
  afterEach(cleanup);

  const saved = [
    {
      id: "c1",
      sourceType: "youtube",
      videoTitle: "How we price interiors",
      summaryJson: {
        summary: "Price by room, not by hour. More detail follows here.",
        keyPoints: [],
      },
      tags: ["project:lotus-bech"],
      status: "completed",
    },
    {
      id: "c2",
      sourceType: "web",
      videoTitle: "Lotus brief",
      tags: ["project:lotus-bech"],
      status: "completed",
    },
  ];

  it("lists the group's saved summaries; clicking one opens it", () => {
    const onOpenSummary = vi.fn();
    renderGroup({}, { saved, onOpenSummary });
    expect(screen.getByText(/Saved/)).toBeTruthy();
    expect(screen.getByText("How we price interiors")).toBeTruthy();
    expect(screen.getByText(/Price by room, not by hour/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Lotus brief/ }));
    expect(onOpenSummary).toHaveBeenCalledWith("c2");
  });

  it("shows nothing extra when the group has no saved clips", () => {
    renderGroup({}, { saved: [], onOpenSummary: vi.fn() });
    expect(screen.queryByText(/^Saved/)).toBeNull();
  });
});

describe("TabGroupSection — save button and per-tab saved marks", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
  });
  afterEach(cleanup);

  it("bottom-right save button shows the group's save state and saves now on click", () => {
    const onSaveNow = vi.fn();
    renderGroup({}, { saveStatus: "saved", onSaveNow });
    const btn = screen.getByRole("button", { name: /Saved/ });
    expect(btn.textContent).toMatch(/Saved/);
    fireEvent.click(btn);
    expect(onSaveNow).toHaveBeenCalled();
  });

  it("says when it's saving, and when it's only on this device", () => {
    renderGroup({}, { saveStatus: "saving", onSaveNow: vi.fn() });
    expect(screen.getByRole("button", { name: /Saving/ })).toBeTruthy();
    cleanup();
    renderGroup({}, { saveStatus: "local", onSaveNow: vi.fn() });
    expect(screen.getByRole("button", { name: /on this device/ })).toBeTruthy();
  });

  it("each tab in the group's saved copy gets a saved mark", () => {
    renderGroup({}, { savedUrls: new Set(["https://x.com/1"]), onSaveNow: vi.fn() });
    const marks = screen.getAllByTitle(/Saved with the group/);
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("li")!.textContent).toContain("Tab 1");
  });
});

describe("TabGroupSection — sort", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — sort");
  });
  afterEach(cleanup);

  it("⋯ → Sort picks how the group orders its tabs, and shows the current one", () => {
    const onSetSort = vi.fn();
    renderGroup({}, { sort: "manual", onSetSort });
    fireEvent.click(screen.getByRole("button", { name: /More actions for project/ }));
    expect(screen.getByRole("button", { name: "Your order" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "A–Z" }));
    expect(onSetSort).toHaveBeenCalledWith("name");
  });
});

describe("TabGroupSection — saved pages that aren't open (bookmark folder)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
  });
  afterEach(cleanup);

  const pages = [
    { url: "https://notion.so/lotus", title: "Lotus brief" },
    { url: "https://figma.com/f", title: "Moodboard" },
  ];

  it("lists them under Not open; click reopens, ✕ removes from the group", () => {
    const onOpenSaved = vi.fn();
    const onRemoveSaved = vi.fn();
    renderGroup({}, { notOpen: pages, onOpenSaved, onRemoveSaved });
    expect(screen.getByText(/Not open/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Lotus brief/ }));
    expect(onOpenSaved).toHaveBeenCalledWith(pages[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Moodboard from this group" }));
    expect(onRemoveSaved).toHaveBeenCalledWith(pages[1]);
  });

  it("shows the first few and a Show all for long folders", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      url: `https://p.com/${i}`,
      title: `Page ${i}`,
    }));
    renderGroup({}, { notOpen: many, onOpenSaved: vi.fn(), onRemoveSaved: vi.fn() });
    expect(screen.queryByText("Page 8")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show all 9/ }));
    expect(screen.getByText("Page 8")).toBeTruthy();
  });
});
