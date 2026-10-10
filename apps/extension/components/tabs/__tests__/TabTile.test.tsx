// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { TabTile } from "../TabTile";
import type { OpenTab } from "../../../lib/tabs/types";

const base: OpenTab = {
  id: 4,
  windowId: 1,
  url: "https://www.mudaricreative.com/inspo",
  title: "Inspo #1 - Mudari",
  active: false,
  lastAccessed: 1,
  discarded: false,
};

function renderTile(tab: Partial<OpenTab> = {}, props: Record<string, unknown> = {}) {
  const h = { onActivate: vi.fn(), onClose: vi.fn() };
  render(
    <ul>
      <TabTile tab={{ ...base, ...tab }} selected={false} groupKey="tag:x" {...h} {...props} />
    </ul>,
  );
  return h;
}

describe("TabTile", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — tiles");
  });
  afterEach(cleanup);

  it("shows the preview image, your name for the page and its site; click switches to it", () => {
    const h = renderTile({ customTitle: "Moodboard" }, { image: "https://cdn.x.com/cover.jpg" });
    const img = document.querySelector("img[data-preview]") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.x.com/cover.jpg");
    expect(screen.getByText("Moodboard")).toBeTruthy();
    expect(screen.getByText("mudaricreative.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Moodboard/ }));
    expect(h.onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it("without a preview image it shows the site's icon instead", () => {
    renderTile();
    expect(document.querySelector("img[data-preview]")).toBeNull();
    expect(document.querySelector("img[data-favicon]")).toBeTruthy();
  });

  it("✕ closes the tab; pinned tabs show 📌; selection is marked", () => {
    const h = renderTile({}, { pinned: true, selected: true });
    fireEvent.click(screen.getByRole("button", { name: "Close Inspo #1 - Mudari" }));
    expect(h.onClose).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
    expect(screen.getByText("📌")).toBeTruthy();
    expect(document.querySelector("li[data-selected]")).toBeTruthy();
  });
});
