import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";

// How a note or voice note gets its tags, the way a video does: tags the owner
// already uses are applied when they fit; anything new is only suggested.

const tagClip = vi.fn();
let configured = true;
vi.mock("../tagger.js", async (orig) => ({
  ...(await orig<typeof import("../tagger.js")>()),
  tagClip: (...a: unknown[]) => tagClip(...a),
  isTaggerConfigured: () => configured,
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const { chooseTags } = await import("../chooseTags.js");

const input = (over: Record<string, unknown> = {}) => ({
  kind: "voice note",
  title: "Ask Maren for the price list",
  summary: "Two follow-ups for Alder House.",
  existingTags: ["alder house", "follow-up", "pricing"],
  proposed: ["Alder House", "follow up", "invoices"],
  current: [],
  ...over,
});

beforeEach(async () => {
  await layer("unit");
  await epic("Library");
  await feature("Auto-tagging");
  tagClip.mockReset();
  configured = true;
});

describe("chooseTags", () => {
  it("asks Jev which existing tags fit, and offers what is new as suggestions", async () => {
    tagClip.mockResolvedValue({ apply: ["alder house", "follow-up"], suggest: ["invoices"] });
    const out = await chooseTags(input());
    expect(out).toEqual({ tags: ["alder house", "follow-up"], suggested: ["invoices"] });
    const asked = tagClip.mock.calls[0][0] as Record<string, unknown>;
    expect(asked).toMatchObject({
      kind: "voice note",
      title: "Ask Maren for the price list",
      existingTags: ["alder house", "follow-up", "pricing"],
      // Lower-cased, and what is already an existing tag is not a "new" idea.
      candidates: ["follow up", "invoices"],
    });
    expect((asked.summaryJson as { summary: string }).summary).toBe(
      "Two follow-ups for Alder House.",
    );
  });

  it("keeps the tags already on it, and does not suggest one it has", async () => {
    tagClip.mockResolvedValue({ apply: ["follow-up"], suggest: ["invoices", "client"] });
    const out = await chooseTags(input({ current: ["client"] }));
    expect(out).toEqual({ tags: ["client", "follow-up"], suggested: ["invoices"] });
  });

  it("works without Jev: exact matches are applied, the rest suggested", async () => {
    configured = false;
    const out = await chooseTags(input());
    expect(out).toEqual({ tags: ["alder house"], suggested: ["follow up", "invoices"] });
    expect(tagClip).not.toHaveBeenCalled();
  });

  it("falls back the same way when Jev fails", async () => {
    tagClip.mockRejectedValue(new Error("timeout"));
    const out = await chooseTags(input());
    expect(out).toEqual({ tags: ["alder house"], suggested: ["follow up", "invoices"] });
  });

  it("only suggests when the owner has no tags yet", async () => {
    const out = await chooseTags(input({ existingTags: [] }));
    expect(out).toEqual({ tags: [], suggested: ["alder house", "follow up", "invoices"] });
    expect(tagClip).not.toHaveBeenCalled();
  });
});
