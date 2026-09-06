// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "@testing-library/jest-dom/vitest";
import "../../test/browser-mock";
import type { Summary, PinnedItem } from "@cliphy/shared";

const clip = (p: Partial<Summary>): Summary =>
  ({
    id: "c1",
    userId: "u",
    sourceType: "web",
    status: "completed",
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...p,
  }) as Summary;

const tilePin: PinnedItem = {
  id: "p1",
  userId: "u",
  kind: "clip",
  layout: "tile",
  position: 0,
  label: "Linear",
  clipId: "c1",
  pinnedAt: "t",
  updatedAt: "t",
};

const getPins = vi.fn();
const getSummaries = vi.fn();
const getPinItems = vi.fn();
const archiveClip = vi.fn(async () => ({ id: "c1", archivedAt: "t" }));
const unarchiveClip = vi.fn(async () => ({ id: "c1", archivedAt: null }));

vi.mock("../../lib/api", () => ({
  getPins: (...a: unknown[]) => getPins(...a),
  getSummaries: (...a: unknown[]) => getSummaries(...a),
  getPinItems: (...a: unknown[]) => getPinItems(...a),
  reorderPins: vi.fn(),
  deletePin: vi.fn(),
  archiveClip: (...a: unknown[]) => archiveClip(...(a as [string])),
  unarchiveClip: (...a: unknown[]) => unarchiveClip(...(a as [string])),
  addBookmark: vi.fn(),
}));
vi.mock("../../lib/newtab-cache", () => ({
  readSnapshot: vi.fn(async () => null),
  writeSnapshot: vi.fn(async () => undefined),
}));

const { PinsBoard } = await import("../pins/PinsBoard");

describe("PinsBoard", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Pins board");
    vi.clearAllMocks();
    getPins.mockResolvedValue({ pins: [tilePin] });
    getSummaries.mockResolvedValue({
      summaries: [clip({ id: "c1", videoTitle: "Pinned Site", sourceUrl: "https://linear.app" })],
    });
    getPinItems.mockResolvedValue({ clips: [] });
  });
  afterEach(cleanup);

  it("renders the capture bar and the inbox panel", async () => {
    render(<PinsBoard columns={1} />);
    expect(screen.getByLabelText("Paste a URL to pin")).toBeInTheDocument();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Pinned Site")).toBeInTheDocument());
  });

  it("renders a tile for a pinned clip", async () => {
    render(<PinsBoard columns={1} />);
    await waitFor(() => {
      const tiles = screen.getAllByText("Linear");
      expect(tiles.length).toBeGreaterThan(0);
    });
  });

  it("shows a stale notice when the API is unreachable, instead of an error", async () => {
    getPins.mockRejectedValue(new Error("offline"));
    render(<PinsBoard columns={1} />);
    await waitFor(() => expect(screen.getByText(/Showing cached view/)).toBeInTheDocument());
  });

  it("archives optimistically and offers undo", async () => {
    render(<PinsBoard columns={1} />);
    await waitFor(() => expect(screen.getByText("Pinned Site")).toBeInTheDocument());

    // Expand the card (peek inline), then archive from the expanded footer.
    fireEvent.click(screen.getByText("Pinned Site"));
    fireEvent.click(await screen.findByText("Archive"));

    await waitFor(() => expect(screen.getByText("Archived.")).toBeInTheDocument());
    expect(archiveClip).toHaveBeenCalledWith("c1");
    expect(screen.queryByText("Pinned Site")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.getByText("Pinned Site")).toBeInTheDocument());
    expect(unarchiveClip).toHaveBeenCalledWith("c1");
  });

  it("shows an empty state rather than vanishing when there are no clips", async () => {
    getSummaries.mockResolvedValue({ summaries: [] });
    render(<PinsBoard columns={1} />);
    await waitFor(() => expect(screen.getByText("Nothing here yet.")).toBeInTheDocument());
    expect(screen.getByText("Inbox")).toBeInTheDocument();
  });
});
