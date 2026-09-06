import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { Summary } from "@cliphy/shared";
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
    epic("Inbox");
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

  it("splits into two columns preserving per-column order and balancing", () => {
    const tall = clip({ sourceType: "image", heroImageUrl: "x" });
    const s1 = clip({ sourceType: "web" });
    const s2 = clip({ sourceType: "web" });
    const s3 = clip({ sourceType: "web" });
    const [a, b] = splitColumns([tall, s1, s2, s3]);
    expect(a.length + b.length).toBe(4);
    expect(a[0].id).toBe(tall.id);
    expect(b.map((c) => c.id)).toEqual([s1.id, s2.id, s3.id]);
  });
});
