// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { ClosedGroups } from "../ClosedGroups";

const NOW = Date.parse("2026-10-10T12:00:00Z");

describe("ClosedGroups", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
  });
  afterEach(cleanup);

  it("lists closed groups with counts and age; Resume resumes", () => {
    const onResume = vi.fn();
    render(
      <ClosedGroups
        groups={[
          {
            key: "tag:freelance:lotus-bech",
            label: "freelance › lotus-bech",
            pages: Array(6).fill({ url: "https://a.com", title: "A" }),
            closedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
          },
        ]}
        now={NOW}
        selectedKey={null}
        onResume={onResume}
      />,
    );
    expect(screen.getByText(/freelance › lotus-bech/)).toBeTruthy();
    expect(screen.getByText(/6 tabs · closed 2h ago/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resume freelance › lotus-bech/ }));
    expect(onResume).toHaveBeenCalledWith("tag:freelance:lotus-bech");
  });

  it("renders nothing when there are no closed groups", () => {
    const { container } = render(
      <ClosedGroups groups={[]} now={NOW} selectedKey={null} onResume={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});
