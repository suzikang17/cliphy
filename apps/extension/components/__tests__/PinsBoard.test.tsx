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
  clipUrl: "https://linear.app",
  clipTitle: "Linear",
  pinnedAt: "t",
  updatedAt: "t",
};

const getPins = vi.fn();
const getSummaries = vi.fn();
const getPinItems = vi.fn();
const archiveClip = vi.fn(async (id: string) => ({ id, archivedAt: "t" }));
const unarchiveClip = vi.fn(async (id: string) => ({ id, archivedAt: null }));

vi.mock("../../lib/api", () => ({
  getPins: (...a: unknown[]) => getPins(...a),
  getSummaries: (...a: unknown[]) => getSummaries(...a),
  getPinItems: (...a: unknown[]) => getPinItems(...a),
  reorderPins: vi.fn(),
  deletePin: vi.fn(),
  archiveClip: (...a: unknown[]) => archiveClip(...(a as [string])),
  unarchiveClip: (...a: unknown[]) => unarchiveClip(...(a as [string])),
  addBookmark: vi.fn(),
  stowTab: vi.fn(),
  getTodayNote: vi.fn(async () => ({ note: null })),
  appendNote: vi.fn(async () => ({ note: {} })),
  updateNote: vi.fn(async () => ({ note: {} })),
  localDate: () => "2026-09-07",
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
      summaries: [clip({ id: "c2", videoTitle: "Inbox Item", sourceUrl: "https://example.test" })],
    });
    getPinItems.mockResolvedValue({ clips: [] });
  });
  afterEach(cleanup);

  it("renders the capture bar and the inbox panel", async () => {
    render(<PinsBoard columns={1} />);
    expect(screen.getByLabelText("Paste a link, or jot a note")).toBeInTheDocument();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Inbox Item")).toBeInTheDocument());
  });

  it("renders a tile for a pinned clip", async () => {
    render(<PinsBoard columns={1} />);
    await waitFor(() => {
      const tiles = screen.getAllByText("Linear");
      expect(tiles.length).toBeGreaterThan(0);
    });
  });

  it("gives the tile a working href so it navigates when clicked", async () => {
    // Regression: tile URLs used to be derived from clips loaded into panels,
    // but a bookmark is metadata-tier and excluded from the inbox, so it was
    // never there and every tile rendered dead.
    render(<PinsBoard columns={1} />);
    await waitFor(() => {
      const tile = screen.getAllByRole("link").find((el) => el.textContent?.includes("Linear"));
      expect(tile).toBeDefined();
      expect(tile).toHaveAttribute("href", "https://linear.app");
    });
  });

  it("keeps a tile-pinned clip out of the inbox feed", async () => {
    getSummaries.mockResolvedValue({
      summaries: [
        clip({ id: "c1", videoTitle: "Linear", sourceUrl: "https://linear.app" }),
        clip({ id: "c2", videoTitle: "Inbox Item", sourceUrl: "https://example.test" }),
      ],
    });
    render(<PinsBoard columns={1} />);
    await waitFor(() => expect(screen.getByText("Inbox Item")).toBeInTheDocument());
    // "Linear" appears once — as a tile — never as an inbox card.
    expect(screen.getAllByText("Linear")).toHaveLength(1);
  });

  it("shows a stale notice when the API is unreachable, instead of an error", async () => {
    getPins.mockRejectedValue(new Error("offline"));
    render(<PinsBoard columns={1} />);
    await waitFor(() => expect(screen.getByText(/Showing cached view/)).toBeInTheDocument());
  });

  it("archives optimistically and offers undo", async () => {
    render(<PinsBoard columns={1} />);
    await waitFor(() => expect(screen.getByText("Inbox Item")).toBeInTheDocument());

    // Expand the card (peek inline), then archive from the expanded footer.
    fireEvent.click(screen.getByText("Inbox Item"));
    fireEvent.click(await screen.findByText("Archive"));

    await waitFor(() => expect(screen.getByText("Archived.")).toBeInTheDocument());
    expect(archiveClip).toHaveBeenCalledWith("c2");
    expect(screen.queryByText("Inbox Item")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.getByText("Inbox Item")).toBeInTheDocument());
    expect(unarchiveClip).toHaveBeenCalledWith("c2");
  });

  it("shows an empty state rather than vanishing when there are no clips", async () => {
    getSummaries.mockResolvedValue({ summaries: [] });
    render(<PinsBoard columns={1} />);
    await waitFor(() => expect(screen.getByText("Nothing here yet.")).toBeInTheDocument());
    expect(screen.getByText("Inbox")).toBeInTheDocument();
  });
});
