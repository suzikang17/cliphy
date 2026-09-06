import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { enrichClip } = await import("../enrich.js");

describe("enrichClip existing-tag reuse", () => {
  beforeEach(() => {
    layer("unit");
    epic("Enrichment");
    feature("Tag Reuse");
    createMock.mockReset();
  });

  it("passes existing tags into the prompt and returns a reused tag", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: '{"summary":"s","tags":["react"],"category":"reading"}' }],
    });
    const result = await enrichClip({
      sourceType: "web",
      title: "React hooks",
      text: "about react",
      existingTags: ["react", "typescript"],
    });
    expect(result.tags).toEqual(["react"]);
    const prompt = createMock.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("react");
    expect(prompt).toContain("typescript");
  });
});
