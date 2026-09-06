/**
 * Live search-embedding smoke test.
 *
 * Opt-in: set RUN_CLIP_SMOKE=1 to run; otherwise skipped so `test:unit` stays offline.
 *
 * Usage:
 *   RUN_CLIP_SMOKE=1 pnpm vitest run apps/server/scripts/smoke-test-search.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { generateEmbedding } from "../src/services/embedding.js";

const run = process.env.RUN_CLIP_SMOKE === "1";
const maybe = run ? it : it.skip;

describe("search embedding smoke (live)", () => {
  beforeEach(() => {
    layer("integration");
    epic("Search");
    feature("Embedding Smoke");
  });

  maybe(
    "embeds a query to 1024 dims",
    async () => {
      const v = await generateEmbedding("distributed systems consensus");
      expect(v).toHaveLength(1024);
    },
    30_000,
  );
});
