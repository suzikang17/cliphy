// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "@testing-library/jest-dom/vitest";
import "../../test/browser-mock";
import { browserMock } from "../../test/browser-mock";

const stowTab = vi.fn(async (url: string, summarize: boolean) => ({
  clip: { id: url, summarize },
}));
vi.mock("../../lib/api", () => ({
  stowTab: (...a: unknown[]) => stowTab(...(a as [string, boolean])),
}));

const { StowTabsPanel } = await import("../pins/StowTabsPanel");

const TABS = [
  { id: 1, url: "https://linear.app", title: "Linear", favIconUrl: "f1" },
  { id: 2, url: "https://vercel.com", title: "Vercel", favIconUrl: "f2" },
  { id: 3, url: "chrome://extensions", title: "Extensions" },
];

describe("StowTabsPanel", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Stow tabs");
    vi.clearAllMocks();
    browserMock.tabs.query.mockResolvedValue(TABS);
    browserMock.tabs.remove.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("lists http tabs and skips chrome:// pages", async () => {
    render(<StowTabsPanel onClose={vi.fn()} onStowed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());
    expect(screen.getByText("Vercel")).toBeInTheDocument();
    expect(screen.queryByText("Extensions")).not.toBeInTheDocument();
  });

  it("checks every tab by default", async () => {
    render(<StowTabsPanel onClose={vi.fn()} onStowed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Stow 2 & close")).toBeInTheDocument());
  });

  it("stows without AI by default, and with AI when that row is toggled", async () => {
    const onStowed = vi.fn();
    render(<StowTabsPanel onClose={vi.fn()} onStowed={onStowed} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Queue Linear for AI summary"));
    fireEvent.click(screen.getByText("Stow 2 & close"));

    await waitFor(() => expect(stowTab).toHaveBeenCalledTimes(2));
    expect(stowTab).toHaveBeenCalledWith("https://linear.app", true);
    expect(stowTab).toHaveBeenCalledWith("https://vercel.com", false);
  });

  it("closes the stowed tabs and reports them for reopening", async () => {
    const onStowed = vi.fn();
    render(<StowTabsPanel onClose={vi.fn()} onStowed={onStowed} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Stow 2 & close"));

    await waitFor(() => expect(browserMock.tabs.remove).toHaveBeenCalledWith([1, 2]));
    expect(onStowed).toHaveBeenCalledWith(2, ["https://linear.app", "https://vercel.com"]);
  });

  it("closes a tab without stowing it", async () => {
    const onStowed = vi.fn();
    render(<StowTabsPanel onClose={vi.fn()} onStowed={onStowed} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    // Deselect both from stowing, but leave Linear marked for closing.
    fireEvent.click(screen.getByLabelText("Stow Linear"));
    fireEvent.click(screen.getByLabelText("Stow Vercel"));
    fireEvent.click(screen.getByLabelText("Close Vercel"));

    fireEvent.click(screen.getByText("Close 1"));

    await waitFor(() => expect(browserMock.tabs.remove).toHaveBeenCalledWith([1]));
    expect(stowTab).not.toHaveBeenCalled();
  });

  it("turns stowing on when AI summary is checked, since AI needs somewhere to land", async () => {
    render(<StowTabsPanel onClose={vi.fn()} onStowed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Stow Linear")); // off
    expect(screen.getByLabelText("Stow Linear")).not.toBeChecked();

    fireEvent.click(screen.getByLabelText("Queue Linear for AI summary"));
    expect(screen.getByLabelText("Stow Linear")).toBeChecked();
  });

  it("clears AI summary when stowing is turned off", async () => {
    render(<StowTabsPanel onClose={vi.fn()} onStowed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Queue Linear for AI summary"));
    expect(screen.getByLabelText("Queue Linear for AI summary")).toBeChecked();

    fireEvent.click(screen.getByLabelText("Stow Linear")); // off
    expect(screen.getByLabelText("Queue Linear for AI summary")).not.toBeChecked();
  });

  it("stows without closing when the close toggle is off for that tab", async () => {
    const onStowed = vi.fn();
    render(<StowTabsPanel onClose={vi.fn()} onStowed={onStowed} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Close Linear"));
    expect(screen.getByText("Stow 2 · close 1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Stow 2 · close 1"));

    await waitFor(() => expect(stowTab).toHaveBeenCalledTimes(2));
    // Both saved; only Vercel closes.
    expect(browserMock.tabs.remove).toHaveBeenCalledWith([2]);
    expect(onStowed).toHaveBeenCalledWith(2, ["https://vercel.com"]);
  });

  it("closes nothing when every close toggle is off", async () => {
    render(<StowTabsPanel onClose={vi.fn()} onStowed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    fireEvent.click(screen.getByText("✕ Close all"));
    expect(screen.getByText("Stow 2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Stow 2"));

    await waitFor(() => expect(stowTab).toHaveBeenCalledTimes(2));
    expect(browserMock.tabs.remove).not.toHaveBeenCalled();
  });

  it("never closes a tab whose save failed", async () => {
    stowTab.mockImplementation(async (url: string, summarize: boolean) => {
      if (url === "https://vercel.com") throw new Error("save failed");
      return { clip: { id: url, summarize } };
    });
    const onStowed = vi.fn();
    render(<StowTabsPanel onClose={vi.fn()} onStowed={onStowed} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Stow 2 & close"));

    // Only the tab that actually saved is closed — a failed save must not eat a tab.
    await waitFor(() => expect(browserMock.tabs.remove).toHaveBeenCalledWith([1]));
    expect(onStowed).toHaveBeenCalledWith(1, ["https://linear.app"]);
  });

  it("saves only stowed tabs, but still closes ones marked for closing", async () => {
    const onStowed = vi.fn();
    render(<StowTabsPanel onClose={vi.fn()} onStowed={onStowed} />);
    await waitFor(() => expect(screen.getByText("Linear")).toBeInTheDocument());

    // Vercel: stow off, close still on — dismissed without being saved.
    fireEvent.click(screen.getByLabelText("Stow Vercel"));
    fireEvent.click(screen.getByText("Stow 1 · close 2"));

    await waitFor(() => expect(stowTab).toHaveBeenCalledTimes(1));
    expect(stowTab).toHaveBeenCalledWith("https://linear.app", false);
    expect(browserMock.tabs.remove).toHaveBeenCalledWith([1, 2]);
    expect(onStowed).toHaveBeenCalledWith(1, ["https://linear.app", "https://vercel.com"]);
  });
});
