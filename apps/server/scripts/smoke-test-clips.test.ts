/**
 * Live extractor smoke tests — hit real web + Twitter endpoints.
 *
 * Opt-in: set RUN_CLIP_SMOKE=1 to run; otherwise every case is skipped so
 * normal `test:unit` runs stay offline and deterministic.
 *
 * Usage:
 *   RUN_CLIP_SMOKE=1 pnpm vitest run apps/server/scripts/smoke-test-clips.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { extractWebClip } from "../src/services/extractors/web.js";
import { extractTweetClip } from "../src/services/extractors/tweet.js";

const run = process.env.RUN_CLIP_SMOKE === "1";
const maybe = run ? it : it.skip;

describe("clip extractor smoke (live)", () => {
  beforeEach(() => {
    layer("integration");
    epic("Ingest");
    feature("Extractor Smoke");
  });

  maybe(
    "extracts a real article with non-empty content",
    async () => {
      const clip = await extractWebClip("https://en.wikipedia.org/wiki/Coffee");
      expect(clip.kind).toBe("article");
      expect(clip.title.toLowerCase()).toContain("coffee");
      expect(clip.content.length).toBeGreaterThan(500);
    },
    30_000,
  );

  maybe(
    "extracts a real tweet with text and author",
    async () => {
      // jack's first tweet — stable, unlikely to be deleted.
      const clip = await extractTweetClip("https://x.com/jack/status/20");
      expect(clip.text.length).toBeGreaterThan(0);
      expect(clip.author.handle.toLowerCase()).toBe("jack");
      expect(clip.threadTweetIds).toContain("20");
    },
    30_000,
  );
});
