import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

// supabase.from() pops a chain per call; each chain resolves to its result
let fromResults: Record<string, unknown>[] = [];
function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "update", "eq", "is", "single"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: () => fromResults.shift() ?? mockChain() },
}));

const tagClipMock = vi.fn();
let configured = true;
vi.mock("../tagger.js", async (orig) => ({
  ...(await orig<typeof import("../tagger.js")>()),
  tagClip: (...args: unknown[]) => tagClipMock(...args),
  isTaggerConfigured: () => configured,
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

const { autoTagClip } = await import("../auto-tag.js");

const summaryJson = { summary: "s", keyPoints: [], timestamps: [], topics: ["sourdough"] };

describe("autoTagClip", () => {
  beforeEach(() => {
    layer("unit");
    epic("Auto-tagging");
    feature("Pipeline step");
    tagClipMock.mockReset();
    configured = true;
    fromResults = [];
  });

  it("merges applied tags into the clip and stores unmatched topics as suggestions", async () => {
    const update = mockChain();
    fromResults = [
      mockChain({
        data: { user_id: "u1", tags: ["cooking"], summary_json: summaryJson, video_title: "T" },
      }),
      mockChain({ data: [{ tags: ["cooking"] }, { tags: ["baking", "cooking"] }] }),
      update,
    ];
    tagClipMock.mockResolvedValue({ apply: ["baking", "cooking"], suggest: ["sourdough"] });

    const result = await autoTagClip("clip-1");

    expect(tagClipMock).toHaveBeenCalledWith({
      summaryJson,
      title: "T",
      existingTags: ["cooking", "baking"],
      candidates: ["sourdough"],
    });
    expect(update.update).toHaveBeenCalledWith({
      tags: ["cooking", "baking"],
      suggested_tags: ["sourdough"],
    });
    expect(result).toEqual({ applied: ["baking"], suggested: ["sourdough"] });
  });

  it("skips clips without a summary", async () => {
    fromResults = [mockChain({ data: { user_id: "u1", tags: [], summary_json: null } })];
    expect(await autoTagClip("clip-1")).toMatchObject({ skipped: "no_summary" });
    expect(tagClipMock).not.toHaveBeenCalled();
  });

  it("skips (without throwing) when Jev isn't configured and the user has tags", async () => {
    configured = false;
    fromResults = [
      mockChain({ data: { user_id: "u1", tags: [], summary_json: summaryJson } }),
      mockChain({ data: [{ tags: ["cooking"] }] }),
    ];
    expect(await autoTagClip("clip-1")).toMatchObject({ skipped: "not_configured" });
    expect(tagClipMock).not.toHaveBeenCalled();
  });

  it("still suggests topics for a brand-new user even without Jev configured", async () => {
    configured = false;
    const update = mockChain();
    fromResults = [
      mockChain({ data: { user_id: "u1", tags: [], summary_json: summaryJson } }),
      mockChain({ data: [] }),
      update,
    ];
    tagClipMock.mockResolvedValue({ apply: [], suggest: ["sourdough"] });

    await autoTagClip("clip-1");
    expect(update.update).toHaveBeenCalledWith({ tags: [], suggested_tags: ["sourdough"] });
  });
});
