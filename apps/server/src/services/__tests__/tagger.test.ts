import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const systemOneMock = vi.fn();
vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: class {
    systemOne = systemOneMock;
  },
  noul: (instructions: string) => ({ type: "noul", instructions }),
  choice: (instructions: string, criteria: Record<string, string>) => ({
    type: "choice",
    instructions,
    criteria,
  }),
}));

const { tagClip, rankTags, mergeTags, MAX_EXISTING_TAGS } = await import("../tagger.js");

const summaryJson = {
  summary: "How to bake sourdough bread at home.",
  keyPoints: ["Feed the starter", "Long cold proof"],
  timestamps: [],
};

const noul = (p: number) => ({ type: "noul", noul: p });
const choice = (c: string, confidence: number) => ({
  type: "choice",
  choice: c,
  confidence,
  probabilities: {},
});

describe("tagger", () => {
  beforeEach(() => {
    layer("unit");
    epic("Auto-tagging");
    feature("Jev tagger");
    systemOneMock.mockReset();
  });

  it("skips Jev and suggests every candidate when the user has no tags", async () => {
    const result = await tagClip({
      summaryJson,
      existingTags: [],
      candidates: ["sourdough", "baking", "sourdough"],
    });
    expect(systemOneMock).not.toHaveBeenCalled();
    expect(result).toEqual({ apply: [], suggest: ["sourdough", "baking"] });
  });

  it("applies existing tags at or above the threshold, highest confidence first", async () => {
    systemOneMock.mockResolvedValue({
      answers: { t0: noul(0.72), t1: noul(0.2), t2: noul(0.95) },
    });
    const result = await tagClip({
      summaryJson,
      existingTags: ["cooking", "finance", "cooking:baking"],
      candidates: [],
    });
    expect(result.apply).toEqual(["cooking:baking", "cooking"]);
    expect(result.suggest).toEqual([]);
  });

  it("asks hierarchical tags by readable path and pins the model", async () => {
    systemOneMock.mockResolvedValue({ answers: { t0: noul(0) } });
    await tagClip({ summaryJson, existingTags: ["cooking:baking"], candidates: [] });
    const req = systemOneMock.mock.calls[0][0];
    expect(req.model).toBe("jev-1.13.0");
    expect(req.questions.t0.instructions).toContain("cooking › baking");
    expect(req.state.summary).toBe(summaryJson.summary);
  });

  it("drops candidates Jev matches to an existing tag; keeps unmatched ones", async () => {
    systemOneMock.mockResolvedValue({
      answers: {
        t0: noul(0.1),
        c0: choice("e0", 0.9), // "bread making" ≈ "baking"
        c1: choice("none", 0.8), // "fermentation" is new
        c2: choice("e0", 0.3), // low-confidence match → still suggested
      },
    });
    const result = await tagClip({
      summaryJson,
      existingTags: ["baking"],
      candidates: ["bread making", "fermentation", "starters"],
    });
    expect(result.suggest).toEqual(["fermentation", "starters"]);
    const req = systemOneMock.mock.calls[0][0];
    expect(req.questions.c0.criteria).toEqual({
      none: expect.any(String),
      e0: "baking",
    });
  });

  it("treats exact candidate matches as duplicates without asking Jev", async () => {
    systemOneMock.mockResolvedValue({ answers: { t0: noul(0.9) } });
    const result = await tagClip({
      summaryJson,
      existingTags: ["baking"],
      candidates: ["baking"],
    });
    expect(Object.keys(systemOneMock.mock.calls[0][0].questions)).toEqual(["t0"]);
    expect(result).toEqual({ apply: ["baking"], suggest: [] });
  });

  it("caps existing tags sent to Jev", async () => {
    systemOneMock.mockResolvedValue({ answers: {} });
    const many = Array.from({ length: MAX_EXISTING_TAGS + 50 }, (_, i) => `tag${i}`);
    await tagClip({ summaryJson, existingTags: many, candidates: [] });
    expect(Object.keys(systemOneMock.mock.calls[0][0].questions)).toHaveLength(MAX_EXISTING_TAGS);
  });

  it("propagates Jev errors to the caller", async () => {
    systemOneMock.mockRejectedValue(new Error("503"));
    await expect(
      tagClip({ summaryJson, existingTags: ["baking"], candidates: [] }),
    ).rejects.toThrow("503");
  });

  it("rankTags orders by usage then name", () => {
    expect(
      rankTags([{ tags: ["b", "a"] }, { tags: ["b"] }, { tags: null }, { tags: ["c", "a"] }]),
    ).toEqual(["a", "b", "c"]); // a,b tied at 2 → alphabetical; c has 1
    expect(rankTags([{ tags: ["x"] }, { tags: ["y", "x"] }])).toEqual(["x", "y"]);
  });

  it("mergeTags unions in order and caps", () => {
    expect(mergeTags(["a", "b"], ["b", "c", "d"], 3)).toEqual(["a", "b", "c"]);
  });
});
