import { beforeEach, describe, it, expect } from "vitest";
import { epic, feature, parentSuite } from "allure-js-commons";
import { parseSummaryResponse } from "../summarizer.js";

describe("parseSummaryResponse", () => {
  beforeEach(() => {
    parentSuite("Unit Tests");
    epic("Video Processing");
    feature("AI Response Parsing");
  });

  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      summary: "This video covers...",
      keyPoints: ["Point 1", "Point 2"],
      timestamps: ["0:00 - Intro", "2:30 - Main topic"],
    });
    const result = parseSummaryResponse(raw);
    expect(result.summary).toBe("This video covers...");
    expect(result.keyPoints).toHaveLength(2);
    expect(result.timestamps).toHaveLength(2);
  });

  it("extracts JSON from markdown code fences", () => {
    const raw = '```json\n{"summary":"test","keyPoints":["a"],"timestamps":["0:00 - Start"]}\n```';
    const result = parseSummaryResponse(raw);
    expect(result.summary).toBe("test");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSummaryResponse("not json at all")).toThrow("Failed to parse summary");
  });

  it("throws on missing required fields", () => {
    expect(() => parseSummaryResponse('{"summary":"ok"}')).toThrow("Failed to parse summary");
  });
});
