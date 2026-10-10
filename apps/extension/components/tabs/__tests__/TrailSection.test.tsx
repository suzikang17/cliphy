// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import type { TrailItem } from "@cliphy/shared";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const api = vi.hoisted(() => ({
  listTrail: vi.fn(),
  deleteTrailItem: vi.fn(),
  promoteTrailItem: vi.fn(),
  getTrailSettings: vi.fn(),
  putTrailSettings: vi.fn(),
  captureTrail: vi.fn(),
}));
vi.mock("../../../lib/api", () => api);

const { TrailSection } = await import("../TrailSection");
const { useTrail } = await import("../../../lib/trail/useTrail");

const item = (id: string, title: string, tags: string[]): TrailItem => ({
  id,
  url: `https://example.com/${id}`,
  title,
  host: "example.com",
  tags,
  closedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  closeCount: 1,
});
const design = item("a", "Type scale notes", ["design"]);
const loose = item("b", "Random blog", []);

function Harness({ authed = true, query = "" }: { authed?: boolean | null; query?: string }) {
  const trail = useTrail({ query, authed });
  return <TrailSection trail={trail} selectedId={null} now={Date.now()} />;
}

describe("TrailSection", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — trail");
    vi.clearAllMocks();
    browserMock.storage.local.set.mockResolvedValue(undefined);
    browserMock.tabs.create.mockResolvedValue({ id: 9 });
    api.listTrail.mockResolvedValue({ items: [design, loose] });
    api.getTrailSettings.mockResolvedValue({ retentionDays: null });
    api.deleteTrailItem.mockResolvedValue({ deleted: true });
    api.promoteTrailItem.mockResolvedValue({ clip: { id: "c1" }, tags: ["design"] });
    api.putTrailSettings.mockImplementation(async (d: number | null) => ({ retentionDays: d }));
  });
  afterEach(cleanup);

  it("is on by default with a one-time notice; Keep dismisses it, Turn off disables the trail", async () => {
    browserMock.storage.local.get.mockResolvedValue({}); // nothing ever set
    render(<Harness />);
    const toggle = await screen.findByRole("switch", { name: "Remember tabs I close" });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/never page content/)).toBeTruthy();
    await waitFor(() => expect(api.listTrail).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.queryByText(/never page content/)).toBeNull());
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ "trail:noticeSeen": true });
  });

  it("Turn off in the notice disables the trail and hides the notice", async () => {
    browserMock.storage.local.get.mockResolvedValue({});
    render(<Harness />);
    await screen.findByRole("button", { name: "Turn off" });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() =>
      expect(browserMock.storage.local.set).toHaveBeenCalledWith({ "trail:enabled": false }),
    );
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
  });

  it("stays off and shows no notice when the user turned it off before", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "trail:enabled": false,
      "trail:noticeSeen": true,
    });
    render(<Harness />);
    const toggle = await screen.findByRole("switch", { name: "Remember tabs I close" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(api.listTrail).not.toHaveBeenCalled();
  });

  it("retention is amount + unit: 3 weeks saves 21 days, forever saves null", async () => {
    browserMock.storage.local.get.mockResolvedValue({
      "trail:enabled": true,
      "trail:noticeSeen": true,
    });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Recently closed settings" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Keep closed tabs unit" }), {
      target: { value: "weeks" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Keep closed tabs amount" }), {
      target: { value: "3" },
    });
    await waitFor(() => expect(api.putTrailSettings).toHaveBeenLastCalledWith(21));
    fireEvent.change(screen.getByRole("combobox", { name: "Keep closed tabs unit" }), {
      target: { value: "forever" },
    });
    await waitFor(() => expect(api.putTrailSettings).toHaveBeenLastCalledWith(null));
  });

  it("is hidden when signed out", () => {
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    const { container } = render(<Harness authed={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("groups by first tag, with untagged items under Other", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    render(<Harness />);
    expect(await screen.findByText("Type scale notes")).toBeTruthy();
    expect(screen.getByText("design")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
    expect(screen.getAllByText(/closed 2h ago/)).toHaveLength(2);
  });

  it("clicking a row reopens it and removes it from the list", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    render(<Harness />);
    const row = await screen.findByText("Type scale notes");
    await act(async () => {
      fireEvent.click(row);
    });
    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: design.url });
    expect(api.deleteTrailItem).toHaveBeenCalledWith("a");
    expect(screen.queryByText("Type scale notes")).toBeNull();
  });

  it("＋ saves it to clips", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    render(<Harness />);
    await screen.findByText("Random blog");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Random blog to clips" }));
    });
    expect(api.promoteTrailItem).toHaveBeenCalledWith("b");
    expect(screen.queryByText("Random blog")).toBeNull();
    expect(screen.getByText(/Saved “Random blog” to clips/)).toBeTruthy();
  });

  it("searches the trail (debounced) when the Tabs view has a query", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    render(<Harness query="type" />);
    await waitFor(() =>
      expect(api.listTrail).toHaveBeenCalledWith({ q: "type", before: undefined }),
    );
  });

  it("Show more fetches the next page", async () => {
    browserMock.storage.local.get.mockResolvedValue({ "trail:enabled": true });
    api.listTrail
      .mockResolvedValueOnce({ items: [design], nextBefore: design.closedAt })
      .mockResolvedValueOnce({ items: [loose] });
    render(<Harness />);
    const more = await screen.findByRole("button", { name: "Show more" });
    await act(async () => {
      fireEvent.click(more);
    });
    expect(api.listTrail).toHaveBeenLastCalledWith({ q: undefined, before: design.closedAt });
    expect(await screen.findByText("Random blog")).toBeTruthy();
    expect(screen.getByText("Type scale notes")).toBeTruthy();
  });
});
