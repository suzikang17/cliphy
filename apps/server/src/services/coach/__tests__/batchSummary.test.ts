import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { buildSummaryPrompt, canSummarize, summaryMatches } from "../batchSummary.js";

const item = (over: Record<string, unknown> = {}) => ({
  label: "Move the sconces above the paragraph on page 2",
  asked: ["can the sconces go above the text on page 2"],
  work: ["Move the sconces up on page 2"],
  state: "done" as const,
  note: null,
  ...over,
});

describe("batch summary", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Batches");
  });

  describe("when a summary may be written", () => {
    it("waits until every item is ticked or carried over", () => {
      expect(canSummarize([{ state: "done" }, { state: "unchecked" }])).toBe(false);
      expect(canSummarize([{ state: "done" }, { state: "not_done" }])).toBe(true);
    });

    it("refuses an empty batch", () => {
      expect(canSummarize([])).toBe(false);
    });
  });

  describe("what the model is given", () => {
    const prompt = buildSummaryPrompt({
      clientName: "Maren",
      projectName: "Alder House",
      items: [
        item(),
        item({
          label: "Swap the hero photo",
          asked: ["new hero pic attached"],
          work: [],
          state: "not_done",
          note: "Waiting on the full-size file",
        }),
      ],
      voice: ["ok on it, should be up tonight"],
    });

    it("names the client and the project", () => {
      expect(prompt.user).toContain("Maren");
      expect(prompt.user).toContain("Alder House");
    });

    it("gives her words, the work and the result for each item", () => {
      expect(prompt.user).toContain("can the sconces go above the text on page 2");
      expect(prompt.user).toContain("Move the sconces up on page 2");
      expect(prompt.user).toMatch(
        /Swap the hero photo[\s\S]*NOT DONE[\s\S]*Waiting on the full-size file/,
      );
    });

    it("shows how the owner writes to this client", () => {
      expect(prompt.user).toContain("ok on it, should be up tonight");
    });

    it("asks for a plain text message with no filler", () => {
      expect(prompt.system).toMatch(/plain text/i);
      expect(prompt.system).toMatch(/no greeting/i);
    });

    it("leaves the voice section out when there is nothing to copy", () => {
      const bare = buildSummaryPrompt({
        clientName: "Maren",
        projectName: null,
        items: [item()],
        voice: [],
      });
      expect(bare.user).not.toMatch(/how I write/i);
    });
  });

  describe("spotting the summary going out", () => {
    const summary =
      "Done on Alder House:\n- Sconces now sit above the text on page 2\n- Footer link fixed";

    it("matches the same text with different spacing", () => {
      expect(
        summaryMatches(
          "Done on Alder House: - Sconces now sit above the text on page 2  - Footer link fixed ",
          summary,
        ),
      ).toBe(true);
    });

    it("matches when a line was added around it", () => {
      expect(summaryMatches(`Hi Maren! ${summary}\nTalk soon`, summary)).toBe(true);
    });

    it("does not match another message", () => {
      expect(summaryMatches("running 10 min late", summary)).toBe(false);
    });

    it("does not match on a short summary inside a long message by accident", () => {
      expect(summaryMatches("ok", "ok")).toBe(false);
    });
  });
});
