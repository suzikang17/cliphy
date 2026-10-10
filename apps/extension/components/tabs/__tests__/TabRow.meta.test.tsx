// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { TabRow } from "../TabRow";
import type { OpenTab } from "../../../lib/tabs/types";

const base: OpenTab = {
  id: 5,
  windowId: 1,
  url: "https://dashboard.stripe.com/invoices",
  title: "Dashboard – Suzi Kang – Stripe",
  active: false,
  lastAccessed: 0,
  discarded: false,
};

function renderRow(tab: Partial<OpenTab> = {}, props: Record<string, unknown> = {}) {
  const onSetMeta = vi.fn().mockResolvedValue(undefined);
  render(
    <ul>
      <TabRow
        tab={{ ...base, ...tab }}
        selected={false}
        trackingSince={null}
        now={0}
        groupKey="site:stripe.com"
        moveTargets={[]}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onMove={vi.fn()}
        onSetMeta={onSetMeta}
        {...props}
      />
    </ul>,
  );
  return onSetMeta;
}

describe("TabRow — rename and note", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — names & notes");
  });
  afterEach(cleanup);

  it("shows your name (page title on hover) and your note", () => {
    renderRow({ customTitle: "Lotus invoice #3", note: "waiting on client" });
    const name = screen.getByText("Lotus invoice #3");
    expect(name.closest("button")!.title).toContain("Page title: Dashboard – Suzi Kang – Stripe");
    expect(screen.getByText(/waiting on client/)).toBeTruthy();
  });

  it("marks a tab untouched for 3+ days as stale, and a recent one not", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    renderRow({ lastAccessed: now - 4 * 86_400_000 }, { now });
    expect(screen.getByText(/stale/)).toBeTruthy();
    cleanup();
    renderRow({ lastAccessed: now - 3_600_000 }, { now });
    expect(screen.queryByText(/stale/)).toBeNull();
  });

  it("renames from the ⋯ menu; Enter saves", async () => {
    const onSetMeta = renderRow();
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    fireEvent.click(screen.getByRole("button", { name: /Rename/ }));
    const input = screen.getByRole("textbox", { name: /Name for/ });
    fireEvent.change(input, { target: { value: "Lotus invoice #3" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSetMeta).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), {
      title: "Lotus invoice #3",
    });
  });

  it("renaming back to the page title (or blank) clears your name", () => {
    const onSetMeta = renderRow({ customTitle: "Mine" });
    fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
    fireEvent.click(screen.getByRole("button", { name: /Rename/ }));
    const input = screen.getByRole("textbox", { name: /Name for/ });
    fireEvent.change(input, { target: { value: base.title } });
    fireEvent.submit(input.closest("form")!);
    expect(onSetMeta).toHaveBeenCalledWith(expect.anything(), { title: "" });
  });

  it("the n shortcut opens the note editor; Esc cancels without saving", () => {
    const onSetMeta = renderRow({}, { noteNonce: 1 });
    const input = screen.getByRole("textbox", { name: /Note for/ });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSetMeta).not.toHaveBeenCalled();
  });
});
