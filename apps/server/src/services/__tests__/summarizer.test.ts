import { beforeEach, describe, it, expect } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { parseSummaryResponse } from "../summarizer.js";

describe("Video Processing", () => {
  describe("parseSummaryResponse", () => {
    beforeEach(() => {
      layer("unit");
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
      const raw =
        '```json\n{"summary":"test","keyPoints":["a"],"timestamps":["0:00 - Start"]}\n```';
      const result = parseSummaryResponse(raw);
      expect(result.summary).toBe("test");
    });

    it("throws on invalid JSON", () => {
      expect(() => parseSummaryResponse("not json at all")).toThrow("Failed to parse summary");
    });

    it("throws on missing required fields", () => {
      expect(() => parseSummaryResponse('{"summary":"ok"}')).toThrow("Failed to parse summary");
    });

    it("rejects a JSON array instead of an object", () => {
      expect(() => parseSummaryResponse("[1, 2, 3]")).toThrow("expected a JSON object");
    });

    it("filters non-string elements from arrays", () => {
      const raw = JSON.stringify({
        summary: "test",
        keyPoints: ["valid", 42, null, "also valid", { nested: true }],
        timestamps: ["0:00 - Start", undefined, "1:00 - End"],
      });
      const result = parseSummaryResponse(raw);
      expect(result.keyPoints).toEqual(["valid", "also valid"]);
      expect(result.timestamps).toEqual(["0:00 - Start", "1:00 - End"]);
    });

    it("truncates oversized summary and array items", () => {
      const longText = "x".repeat(2000);
      const raw = JSON.stringify({
        summary: longText,
        keyPoints: [longText],
        timestamps: ["0:00 - Start"],
      });
      const result = parseSummaryResponse(raw);
      expect(result.summary.length).toBe(1000);
      expect(result.keyPoints[0].length).toBe(500);
    });
  });
});
