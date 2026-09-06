import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { analyzeImage } = await import("../vision.js");

describe("analyzeImage", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Vision");
    createMock.mockReset();
  });

  it("sends an image block and parses the JSON reply", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "text", text: '{"kind":"visual","extractedText":"","description":"a chart"}' },
      ],
    });
    const result = await analyzeImage(Buffer.from("fake"), "image/jpeg");
    expect(result.kind).toBe("visual");
    expect(result.description).toBe("a chart");

    const arg = createMock.mock.calls[0][0];
    const blocks = arg.messages[0].content;
    expect(blocks.some((b: { type: string }) => b.type === "image")).toBe(true);
  });
});
