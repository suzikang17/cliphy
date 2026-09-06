// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "@testing-library/jest-dom/vitest";
import type { Summary } from "@cliphy/shared";
import { ClipCard, MasonryGrid } from "@cliphy/shared";

function clip(p: Partial<Summary>): Summary {
  return {
    id: "c1",
    userId: "u",
    sourceType: "web",
    status: "completed",
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...p,
  } as Summary;
}

describe("shared ClipCard (DOM)", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Cards");
  });
  afterEach(cleanup);

  it("renders a tweet with handle and thread count", () => {
    render(
      <ClipCard
        item={clip({
          sourceType: "tweet",
          content: "hello world",
          sourceMetadata: { handle: "jack", threadTweetIds: ["1", "2", "3"] },
        })}
      />,
    );
    expect(screen.getByText("@jack")).toBeInTheDocument();
    expect(screen.getByText("🧵 3")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders a web clip with site name and reading time", () => {
    render(
      <ClipCard
        item={clip({
          sourceType: "web",
          videoTitle: "Some Article",
          excerpt: "An excerpt",
          sourceMetadata: { siteName: "Example", kind: "article", readingTimeMin: 7 },
        })}
      />,
    );
    expect(screen.getByText("Some Article")).toBeInTheDocument();
    expect(screen.getByText(/Example · 7 min read/)).toBeInTheDocument();
  });

  it("shows Processing… for an in-flight image clip", () => {
    render(<ClipCard item={clip({ sourceType: "image", status: "processing" })} />);
    expect(screen.getByText("Processing…")).toBeInTheDocument();
  });

  it("falls back to the queue card for youtube and podcast", () => {
    render(
      <ClipCard
        item={clip({ sourceType: "youtube", videoTitle: "A Video", videoChannel: "Chan" })}
      />,
    );
    expect(screen.getByText("A Video")).toBeInTheDocument();
    expect(screen.getByText(/Chan/)).toBeInTheDocument();

    cleanup();
    render(
      <ClipCard item={clip({ sourceType: "podcast", videoTitle: "An Episode", author: "Show" })} />,
    );
    expect(screen.getByText("An Episode")).toBeInTheDocument();
  });

  it("hands the clip back to the host on click, rather than navigating itself", () => {
    const onOpen = vi.fn();
    const item = clip({ sourceType: "web", videoTitle: "Clickable" });
    render(<ClipCard item={item} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Clickable"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("renders every item exactly once across masonry columns", () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      clip({ id: `c${i}`, sourceType: "web", videoTitle: `Item ${i}` }),
    );
    render(
      <MasonryGrid
        items={items}
        columns={3}
        renderItem={(c) => <ClipCard key={c.id} item={c} />}
      />,
    );
    for (let i = 0; i < 7; i++) {
      expect(screen.getByText(`Item ${i}`)).toBeInTheDocument();
    }
  });
});
