/**
 * Live Jev (TypeSafe AI) tagger smoke test — hits the real systemOne API.
 *
 * Opt-in: set RUN_TAGGER_SMOKE=1 and TYPESAFE_API_KEY; otherwise skipped so `test:unit` stays offline.
 *
 * Usage:
 *   RUN_TAGGER_SMOKE=1 pnpm vitest run apps/server/scripts/smoke-test-tagger.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { tagClip } from "../src/services/tagger.js";

const run = process.env.RUN_TAGGER_SMOKE === "1" && Boolean(process.env.TYPESAFE_API_KEY);
const maybe = run ? it : it.skip;

const summaryJson = {
  summary:
    "A baker walks through making a sourdough loaf at home, from feeding the starter to a long cold proof and baking in a Dutch oven.",
  keyPoints: [
    "Feed the starter 4-12 hours before mixing",
    "Autolyse flour and water for an hour",
    "Stretch and folds build gluten strength",
    "Cold proof overnight in the fridge for flavor",
    "Bake covered at 250°C, then uncovered to brown the crust",
  ],
  timestamps: [],
};

describe("tagger smoke (live Jev)", () => {
  beforeEach(() => {
    layer("integration");
    epic("Auto-tagging");
    feature("Jev Smoke");
  });

  maybe(
    "applies fitting existing tags, rejects unrelated ones, dedupes candidates",
    async () => {
      const r = await tagClip({
        summaryJson,
        title: "My no-fail sourdough method",
        existingTags: ["cooking:baking", "personal finance", "javascript", "fitness"],
        candidates: ["bread baking", "sourdough", "fermentation"],
      });
      console.log("Jev result:", JSON.stringify(r));

      expect(r.apply).toContain("cooking:baking");
      expect(r.apply).not.toContain("personal finance");
      expect(r.apply).not.toContain("javascript");
      expect(r.suggest).not.toContain("bread baking"); // ≈ cooking:baking
      expect(r.suggest.length).toBeGreaterThan(0); // sourdough/fermentation are genuinely new
    },
    30_000,
  );
});
