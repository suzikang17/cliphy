// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { PinnedGroup } from "../PinnedGroup";
import type { PagePin } from "../../../lib/tabs/pins";
import type { OpenTab } from "../../../lib/tabs/types";

const pins: PagePin[] = [
  { pinId: "p1", clipId: "c1", url: "https://a.com/x", key: "https://a.com/x", title: "Open one" },
  { pinId: "p2", clipId: "c2", url: "https://b.com/", key: "https://b.com/", title: "Closed one" },
];
const openTab: OpenTab = {
  id: 7,
  windowId: 1,
  url: "https://a.com/x",
  title: "Open one",
  active: false,
  lastAccessed: 1,
  discarded: false,
};

describe("PinnedGroup", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — pins");
  });
  afterEach(cleanup);

  it("lists closed pins as rows, counts open ones, and opens / unpins", () => {
    const onOpen = vi.fn();
    const onUnpin = vi.fn();
    render(
      <PinnedGroup
        pins={pins}
        openByKey={new Map([["https://a.com/x", openTab]])}
        selectedPinId={null}
        onOpen={onOpen}
        onUnpin={onUnpin}
      />,
    );
    expect(screen.getByText(/1 open/)).toBeTruthy();
    expect(screen.queryByText("Open one")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Closed one/ }));
    expect(onOpen).toHaveBeenCalledWith(pins[1]);
    fireEvent.click(screen.getByRole("button", { name: /Unpin Closed one/ }));
    expect(onUnpin).toHaveBeenCalledWith(pins[1]);
  });

  it("renders nothing without pins", () => {
    const { container } = render(
      <PinnedGroup
        pins={[]}
        openByKey={new Map()}
        selectedPinId={null}
        onOpen={vi.fn()}
        onUnpin={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
