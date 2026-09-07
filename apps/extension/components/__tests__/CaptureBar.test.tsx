// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "@testing-library/jest-dom/vitest";
import "../../test/browser-mock";

const addBookmark = vi.fn(async () => ({ clip: { id: "c1" }, pin: { id: "p1" } }));
const appendNote = vi.fn(async () => ({ note: { id: "n1" } }));
vi.mock("../../lib/api", () => ({
  addBookmark: (...a: unknown[]) => addBookmark(...(a as [])),
  appendNote: (...a: unknown[]) => appendNote(...(a as [])),
  localDate: () => "2026-09-07",
}));

const { CaptureBar } = await import("../pins/CaptureBar");

function type(value: string) {
  const input = screen.getByLabelText("Paste a link, or jot a note");
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("CaptureBar routing", () => {
  beforeEach(() => {
    layer("unit");
    epic("Notes");
    feature("Capture routing");
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("bookmarks a link", async () => {
    render(<CaptureBar onAdded={vi.fn()} onNoted={vi.fn()} />);
    type("https://linear.app");
    await waitFor(() => expect(addBookmark).toHaveBeenCalledWith("https://linear.app"));
    expect(appendNote).not.toHaveBeenCalled();
  });

  it("normalises a bare host before bookmarking it", async () => {
    render(<CaptureBar onAdded={vi.fn()} onNoted={vi.fn()} />);
    type("linear.app");
    await waitFor(() => expect(addBookmark).toHaveBeenCalledWith("https://linear.app"));
  });

  it("writes prose to today's note instead", async () => {
    const onNoted = vi.fn();
    render(<CaptureBar onAdded={vi.fn()} onNoted={onNoted} />);
    type("shipped the pins tab today");
    await waitFor(() =>
      expect(appendNote).toHaveBeenCalledWith("shipped the pins tab today", "2026-09-07"),
    );
    expect(addBookmark).not.toHaveBeenCalled();
    await waitFor(() => expect(onNoted).toHaveBeenCalled());
  });

  it("treats a sentence mentioning a domain as a note, not a bookmark", async () => {
    render(<CaptureBar onAdded={vi.fn()} onNoted={vi.fn()} />);
    type("check linear.app later");
    await waitFor(() => expect(appendNote).toHaveBeenCalled());
    expect(addBookmark).not.toHaveBeenCalled();
  });

  it("clears the input after saving", async () => {
    render(<CaptureBar onAdded={vi.fn()} onNoted={vi.fn()} />);
    type("a thought");
    await waitFor(() =>
      expect(screen.getByLabelText("Paste a link, or jot a note")).toHaveValue(""),
    );
  });
});
