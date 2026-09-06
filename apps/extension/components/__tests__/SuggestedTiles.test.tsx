// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "@testing-library/jest-dom/vitest";
import "../../test/browser-mock";
import { browserMock } from "../../test/browser-mock";
import { SuggestedTiles } from "../pins/SuggestedTiles";

const HISTORY = [
  { url: "https://linear.app/inbox", title: "Linear", visitCount: 40, typedCount: 12 },
  { url: "https://github.com/x", title: "GitHub", visitCount: 30, typedCount: 2 },
  { url: "https://www.google.com/search?q=a", title: "g", visitCount: 900, typedCount: 0 },
];

describe("SuggestedTiles", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("History suggestions");
    vi.clearAllMocks();
    browserMock.permissions.request.mockResolvedValue(true);
    browserMock.history.search.mockResolvedValue(HISTORY);
  });
  afterEach(cleanup);

  it("does not touch history until the user asks", () => {
    render(<SuggestedTiles pinnedUrls={[]} onPin={vi.fn()} />);
    expect(browserMock.history.search).not.toHaveBeenCalled();
    expect(browserMock.permissions.request).not.toHaveBeenCalled();
  });

  it("requests the history permission before reading anything", async () => {
    render(<SuggestedTiles pinnedUrls={[]} onPin={vi.fn()} />);
    fireEvent.click(screen.getByText("Suggest tiles from history"));

    await waitFor(() =>
      expect(browserMock.permissions.request).toHaveBeenCalledWith({ permissions: ["history"] }),
    );
    await waitFor(() => expect(screen.getByText("linear.app")).toBeInTheDocument());
  });

  it("never reads history when permission is denied", async () => {
    browserMock.permissions.request.mockResolvedValue(false);
    render(<SuggestedTiles pinnedUrls={[]} onPin={vi.fn()} />);
    fireEvent.click(screen.getByText("Suggest tiles from history"));

    await waitFor(() => expect(screen.getByText(/Needs history access/)).toBeInTheDocument());
    expect(browserMock.history.search).not.toHaveBeenCalled();
  });

  it("ranks typed destinations above clicked ones and drops search pages", async () => {
    render(<SuggestedTiles pinnedUrls={[]} onPin={vi.fn()} />);
    fireEvent.click(screen.getByText("Suggest tiles from history"));

    await waitFor(() => expect(screen.getByText("linear.app")).toBeInTheDocument());
    const hosts = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(hosts[0]).toContain("linear.app");
    expect(hosts.join()).not.toContain("google.com");
  });

  it("does not suggest a site that is already pinned", async () => {
    render(<SuggestedTiles pinnedUrls={["https://linear.app"]} onPin={vi.fn()} />);
    fireEvent.click(screen.getByText("Suggest tiles from history"));

    await waitFor(() => expect(screen.getByText("github.com")).toBeInTheDocument());
    expect(screen.queryByText("linear.app")).not.toBeInTheDocument();
  });

  it("pins a suggestion and removes it from the list", async () => {
    const onPin = vi.fn().mockResolvedValue(undefined);
    render(<SuggestedTiles pinnedUrls={[]} onPin={onPin} />);
    fireEvent.click(screen.getByText("Suggest tiles from history"));
    await waitFor(() => expect(screen.getByText("linear.app")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Pin linear.app"));

    await waitFor(() =>
      expect(onPin).toHaveBeenCalledWith(expect.objectContaining({ origin: "https://linear.app" })),
    );
    await waitFor(() => expect(screen.queryByText("linear.app")).not.toBeInTheDocument());
  });
});
