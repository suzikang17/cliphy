// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { Summary } from "@cliphy/shared";
import "@testing-library/jest-dom/vitest";
import "../../test/browser-mock";
import { browserMock } from "../../test/browser-mock";
import { BatchTabsButton } from "../BatchTabsButton";

const mockTabsQuery = browserMock.tabs.query;
const mockTabsSendMessage = browserMock.tabs.sendMessage;

const baseSummaries: Summary[] = [
  {
    id: "1",
    videoId: "existing1",
    status: "completed",
    userId: "u1",
    tags: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "2",
    videoId: "existing2",
    status: "pending",
    userId: "u1",
    tags: [],
    createdAt: "",
    updatedAt: "",
  },
];

const makeTabs = (ids: number[]) =>
  ids.map((id) => ({
    id,
    url: `https://www.youtube.com/watch?v=video${id}`,
  }));

const makeVideoInfo = (id: number) => ({
  videoId: `video${id}`,
  title: `Video ${id}`,
  url: `https://www.youtube.com/watch?v=video${id}`,
  channel: `Channel ${id}`,
  duration: "10:00",
  isLive: false,
});

describe("BatchTabsButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no queueable tabs exist", async () => {
    mockTabsQuery.mockResolvedValue([]);
    const { container } = render(
      <BatchTabsButton summaries={baseSummaries} currentVideoId={null} onBatchQueue={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders nothing when all tabs are already in queue", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue({
      videoId: "existing1",
      title: "Existing",
      url: "https://www.youtube.com/watch?v=existing1",
      channel: "Ch",
      duration: "5:00",
      isLive: false,
    });
    const { container } = render(
      <BatchTabsButton summaries={baseSummaries} currentVideoId={null} onBatchQueue={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders button when queueable tabs exist", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage.mockImplementation((_tabId: number) =>
      Promise.resolve(makeVideoInfo(_tabId)),
    );
    render(
      <BatchTabsButton summaries={baseSummaries} currentVideoId={null} onBatchQueue={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
  });

  it("filters out live streams", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue({
      ...makeVideoInfo(10),
      isLive: true,
    });
    const { container } = render(
      <BatchTabsButton summaries={baseSummaries} currentVideoId={null} onBatchQueue={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("filters out current active tab video", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue(makeVideoInfo(10));
    const { container } = render(
      <BatchTabsButton summaries={baseSummaries} currentVideoId="video10" onBatchQueue={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("skips tabs where content script is not available", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage
      .mockRejectedValueOnce(new Error("Could not establish connection"))
      .mockResolvedValueOnce(makeVideoInfo(20));
    render(
      <BatchTabsButton summaries={baseSummaries} currentVideoId={null} onBatchQueue={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
  });

  it("opens dropdown on click and shows discovered tabs", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage.mockImplementation((_tabId: number) =>
      Promise.resolve(makeVideoInfo(_tabId)),
    );
    render(
      <BatchTabsButton summaries={baseSummaries} currentVideoId={null} onBatchQueue={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/All tabs/));
    await waitFor(() => {
      expect(screen.getByText("Video 10")).toBeTruthy();
      expect(screen.getByText("Video 20")).toBeTruthy();
    });
  });

  it("calls onBatchQueue with selected video URLs on confirm", async () => {
    const onBatchQueue = vi.fn().mockResolvedValue({ added: 2, skipped: 0 });
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage.mockImplementation((_tabId: number) =>
      Promise.resolve(makeVideoInfo(_tabId)),
    );
    render(
      <BatchTabsButton
        summaries={baseSummaries}
        currentVideoId={null}
        onBatchQueue={onBatchQueue}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/All tabs/));
    await waitFor(() => {
      expect(screen.getByText(/Queue 2 videos/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Queue 2 videos/));
    await waitFor(() => {
      expect(onBatchQueue).toHaveBeenCalledWith([
        { videoUrl: "https://www.youtube.com/watch?v=video10" },
        { videoUrl: "https://www.youtube.com/watch?v=video20" },
      ]);
    });
  });

  it("allows failed summaries to be re-queued", async () => {
    const summariesWithFailed: Summary[] = [
      ...baseSummaries,
      {
        id: "3",
        videoId: "video10",
        status: "failed",
        userId: "u1",
        tags: [],
        createdAt: "",
        updatedAt: "",
      },
    ];
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue(makeVideoInfo(10));
    render(
      <BatchTabsButton
        summaries={summariesWithFailed}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
  });
});
