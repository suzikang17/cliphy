import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { parseVisionResult, shouldTile, mergeTiles } from "../vision.js";

describe("vision helpers", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Vision");
  });

  it("parses fenced JSON into a VisionResult", () => {
    const raw =
      '```json\n{"kind":"text","extractedText":"hello","description":"a note","detectedTweetUrl":"https://x.com/a/status/1"}\n```';
    const r = parseVisionResult(raw);
    expect(r.kind).toBe("text");
    expect(r.extractedText).toBe("hello");
    expect(r.description).toBe("a note");
    expect(r.detectedTweetUrl).toBe("https://x.com/a/status/1");
  });

  it("defaults to visual on unparseable input", () => {
    const r = parseVisionResult("not json");
    expect(r.kind).toBe("visual");
    expect(r.extractedText).toBe("");
  });

  it("tiles only tall images (height/width > 4)", () => {
    expect(shouldTile(1000, 5000)).toBe(true);
    expect(shouldTile(1000, 3000)).toBe(false);
    expect(shouldTile(1000, 1000)).toBe(false);
  });

  it("merges tiles: concatenates text, keeps first tweet, flags partial", () => {
    const merged = mergeTiles([
      {
        kind: "text",
        extractedText: "line one",
        description: "top",
        detectedTweetUrl: "https://x.com/a/status/1",
      },
      { kind: "text", extractedText: "line two", description: "bottom", partial: true },
    ]);
    expect(merged.kind).toBe("text");
    expect(merged.extractedText).toBe("line one\nline two");
    expect(merged.detectedTweetUrl).toBe("https://x.com/a/status/1");
    expect(merged.partial).toBe(true);
  });
});
