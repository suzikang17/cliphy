import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { Summary } from "../types";
import { heightEstimate, splitColumns } from "../masonry";

function clip(p: Partial<Summary>): Summary {
  return {
    id: Math.random().toString(36),
    userId: "u",
    sourceType: "web",
    status: "completed",
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...p,
  } as Summary;
}

describe("masonry", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Masonry");
  });

  it("estimates image and tweet-with-media taller than a bare link", () => {
    const link = heightEstimate(clip({ sourceType: "web" }));
    const image = heightEstimate(clip({ sourceType: "image", heroImageUrl: "x" }));
    const tweet = heightEstimate(
      clip({ sourceType: "tweet", sourceMetadata: { media: [{ type: "photo", url: "x" }] } }),
    );
    expect(image).toBeGreaterThan(link);
    expect(tweet).toBeGreaterThan(link);
  });

  it("defaults to two columns, preserving per-column order", () => {
    const tall = clip({ sourceType: "image", heroImageUrl: "x" });
    const s1 = clip({ sourceType: "web" });
    const s2 = clip({ sourceType: "web" });
    const s3 = clip({ sourceType: "web" });
    const cols = splitColumns([tall, s1, s2, s3]);
    expect(cols).toHaveLength(2);
    expect(cols[0][0].id).toBe(tall.id);
    expect(cols[1].map((c) => c.id)).toEqual([s1.id, s2.id, s3.id]);
  });

  it("splits into five columns for a wide surface", () => {
    const items = Array.from({ length: 10 }, () => clip({ sourceType: "web" }));
    const cols = splitColumns(items, 5);
    expect(cols).toHaveLength(5);
    expect(cols.flat()).toHaveLength(10);
    for (const col of cols) expect(col).toHaveLength(2);
  });

  it("returns the requested number of columns even when empty", () => {
    const cols = splitColumns([], 4);
    expect(cols).toHaveLength(4);
    expect(cols.flat()).toHaveLength(0);
  });

  it("puts a single item in the first column", () => {
    const only = clip({ sourceType: "web" });
    const cols = splitColumns([only], 3);
    expect(cols[0].map((c) => c.id)).toEqual([only.id]);
    expect(cols[1]).toHaveLength(0);
    expect(cols[2]).toHaveLength(0);
  });
});
