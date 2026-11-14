import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, type FakeDb } from "../../routes/coach/__tests__/helpers.js";

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
const runImageVision = vi.fn();
vi.mock("../processImage.js", () => ({
  runImageVision: (...a: unknown[]) => runImageVision(...a),
}));
const enrichClip = vi.fn();
vi.mock("../enrich.js", () => ({ enrichClip: (...a: unknown[]) => enrichClip(...a) }));

const { createImageClip } = await import("../imageClip.js");

describe("createImageClip", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Image clip");
    runImageVision.mockReset();
    enrichClip.mockReset();
    db = makeDb((op) => {
      if (op.table === "clips" && op.action === "insert") {
        return { data: { id: "c1", ...(op.payload as object) } };
      }
      if (op.table === "clips") return { data: [{ tags: ["idea"] }] };
      return undefined;
    });
    runImageVision.mockResolvedValue({
      kind: "text",
      content: "hello",
      excerpt: "hello",
      metadata: { storagePath: "coach/u1/a.png" },
    });
    enrichClip.mockResolvedValue({ summary: "s", tags: ["typography"], category: "idea" });
  });

  it("merges extra tags into the created clip", async () => {
    const row = await createImageClip("u1", "coach/u1/a.png", ["project:alder-house"]);
    expect(row.tags).toEqual(["project:alder-house", "typography"]);
    expect(row).toMatchObject({ id: "c1", source_type: "image", status: "completed" });
  });

  it("keeps the extra tags when vision fails, and marks the clip failed", async () => {
    runImageVision.mockRejectedValue(new Error("unsupported image"));
    const row = await createImageClip("u1", "coach/u1/a.heic", ["project:alder-house"]);
    expect(row).toMatchObject({
      status: "failed",
      error_message: "unsupported image",
      tags: ["project:alder-house"],
    });
  });

  it("throws when the clip cannot be saved", async () => {
    db = makeDb((op) =>
      op.action === "insert" ? { data: null, error: { message: "x" } } : { data: [] },
    );
    await expect(createImageClip("u1", "coach/u1/a.png", [])).rejects.toThrow(/save clip/i);
  });
});
