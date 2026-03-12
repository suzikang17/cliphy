// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import type { VideoInfo } from "@cliphy/shared";
import { QueueList } from "../QueueList";
import "@testing-library/jest-dom/vitest";
import "../../test/browser-mock";

const baseVideo: VideoInfo = {
  videoId: "abc123",
  title: "Test Video",
  url: "https://www.youtube.com/watch?v=abc123",
  channel: "Test Channel",
  duration: "10:00",
  isLive: false,
};

const noop = () => {};

const defaultProps = {
  summaries: [],
  onAddToQueue: noop,
  isAdding: false,
  addStatus: "idle" as const,
  onViewSummary: noop,
  onOpenSummary: noop,
  onRemove: noop,
  onRetry: noop,
};

describe("QueueList — CurrentVideoItem", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Queue Video Card");
  });

  afterEach(() => {
    cleanup();
  });

  it("shows disabled 'Unavailable' button for livestreams", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, isLive: true }} />);
    const btn = screen.getByRole("button", { name: /unavailable/i });
    expect(btn).toBeDisabled();
  });

  it("shows livestream warning text", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, isLive: true }} />);
    expect(screen.getByText(/livestreams can't be summarized/i)).toBeTruthy();
  });

  it("shows disabled 'Unavailable' button for too-long videos", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, duration: "5:00:00" }} />);
    const btn = screen.getByRole("button", { name: /unavailable/i });
    expect(btn).toBeDisabled();
  });

  it("shows too-long warning text", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, duration: "5:00:00" }} />);
    expect(screen.getByText(/too long to summarize/i)).toBeTruthy();
  });

  it("shows enabled 'Summarize Video' button for normal videos", () => {
    render(<QueueList {...defaultProps} currentVideo={baseVideo} />);
    const btn = screen.getByRole("button", { name: /summarize video/i });
    expect(btn).not.toBeDisabled();
  });

  it("shows 'Unavailable' for livestream even if also too long", () => {
    render(
      <QueueList
        {...defaultProps}
        currentVideo={{ ...baseVideo, isLive: true, duration: "5:00:00" }}
      />,
    );
    expect(screen.getByText(/livestreams can't be summarized/i)).toBeTruthy();
    expect(screen.queryByText(/too long to summarize/i)).toBeNull();
  });

  it("shows upgrade button when at limit", () => {
    render(
      <QueueList {...defaultProps} currentVideo={baseVideo} atLimit={true} onUpgrade={noop} />,
    );
    expect(screen.getByRole("button", { name: /unlock with pro/i })).toBeTruthy();
  });

  it("shows 'Adding...' while adding", () => {
    render(<QueueList {...defaultProps} currentVideo={baseVideo} isAdding={true} />);
    expect(screen.getByRole("button", { name: /adding/i })).toBeDisabled();
  });

  it("shows 'Queued' after successful add", () => {
    render(<QueueList {...defaultProps} currentVideo={baseVideo} addStatus="queued" />);
    expect(screen.getByRole("button", { name: /queued/i })).toBeDisabled();
  });
});
