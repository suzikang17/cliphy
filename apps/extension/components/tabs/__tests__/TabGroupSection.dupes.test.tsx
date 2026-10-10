// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { TabGroupSection } from "../TabGroupSection";
import type { OpenTab } from "../../../lib/tabs/types";
import type { TabGroup } from "../../../lib/tabs/organize";

const t = (id: number, url: string, title: string, extra: Partial<OpenTab> = {}): OpenTab => ({
  id,
  windowId: 1,
  url,
  title,
  active: false,
  lastAccessed: 100 - id,
  discarded: false,
  ...extra,
});

const keeper = t(2, "https://wix.com/home", "Home | Wix.com", { active: true });
const copyA = t(5, "https://www.wix.com/home#x", "Home | Wix.com");
const copyB = t(6, "https://wix.com/home", "Home | Wix.com");
const other = t(3, "https://wecuratelife.com", "We curate life");
const group = {
  key: "tag:project:lotus-bech",
  kind: "tag",
  value: "project:lotus-bech",
  label: "project › lotus-bech",
  tabs: [copyA, keeper, other, copyB],
} as TabGroup;

describe("TabGroupSection — nested duplicates", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — duplicates");
  });
  afterEach(cleanup);

  function renderGroup(onCloseTabs = vi.fn()) {
    render(
      <ul>
        <TabGroupSection
          group={group}
          collapsed={false}
          onToggle={vi.fn()}
          selectedTabId={null}
          moveTargets={[]}
          canStow
          trackingSince={null}
          now={0}
          onActivate={vi.fn()}
          onCloseTabs={onCloseTabs}
          onStowTabs={vi.fn()}
          onMove={vi.fn()}
          onSaveHints={vi.fn()}
          onSaveAsTag={vi.fn()}
          onDismiss={vi.fn()}
        />
      </ul>,
    );
    return onCloseTabs;
  }

  it("nests copies under one parent and its button closes only the children", () => {
    const onCloseTabs = renderGroup();
    // Order: parent (active keeper) → its 2 copies → the unrelated tab.
    const titles = screen
      .getAllByText(/Home \| Wix.com|We curate life/)
      .map((el) => el.textContent);
    expect(titles).toEqual([
      "Home | Wix.com",
      "Home | Wix.com",
      "Home | Wix.com",
      "We curate life",
    ]);

    fireEvent.click(screen.getByRole("button", { name: /×2 close dupes/ }));
    expect(onCloseTabs).toHaveBeenCalledWith([copyA, copyB]);
  });

  it("shows no dupes button on pages open only once", () => {
    renderGroup();
    expect(screen.getAllByRole("button", { name: /close dupes/ })).toHaveLength(1);
  });
});
