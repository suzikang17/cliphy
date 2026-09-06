import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const updateEq = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      single: () => ({
        data: {
          id: "c1",
          user_id: "u1",
          hero_image_url: "u1/a.jpg",
          source_metadata: { storagePath: "u1/a.jpg" },
        },
        error: null,
      }),
    }),
  }),
  update: () => ({ eq: updateEq }),
}));
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: fromMock } }));
const sendMock = vi.fn();
vi.mock("../../lib/inngest.js", () => ({
  inngest: { createFunction: (_c: unknown, fn: unknown) => fn, send: sendMock },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) },
}));
vi.mock("../../lib/storage.js", () => ({
  downloadImage: vi.fn(async () => ({ bytes: Buffer.from("x"), mediaType: "image/jpeg" })),
}));
vi.mock("../../services/tiling.js", () => ({
  imageSize: vi.fn(async () => ({ width: 800, height: 600 })),
  tileImage: vi.fn(async (b: Buffer) => [b]),
}));
vi.mock("../../services/vision.js", () => ({
  shouldTile: vi.fn(() => false),
  mergeTiles: (r: unknown[]) => r[0],
  analyzeImage: vi.fn(async () => ({
    kind: "text",
    extractedText: "hello world",
    description: "a note",
  })),
}));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));

const { visionClip } = await import("../visionClip.js");
const { inngest } = await import("../../lib/inngest.js");

function runStep() {
  return { run: async (_n: string, fn: () => Promise<unknown>) => fn() };
}

describe("visionClip worker", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Vision Worker");
    vi.clearAllMocks();
  });

  it("analyzes the image, writes content, and fires embed", async () => {
    await (visionClip as unknown as (a: unknown) => Promise<unknown>)({
      event: { data: { clipId: "c1" } },
      step: runStep(),
    });
    expect(updateEq).toHaveBeenCalled();
    expect(inngest.send).toHaveBeenCalledWith({
      name: "clip/embed.requested",
      data: { clipId: "c1" },
    });
  });
});
