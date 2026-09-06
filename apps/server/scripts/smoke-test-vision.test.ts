/**
 * Live vision smoke tests — hit the real Claude vision API.
 *
 * Opt-in: set RUN_CLIP_SMOKE=1 to run; otherwise skipped so `test:unit` stays offline.
 *
 * Usage:
 *   RUN_CLIP_SMOKE=1 pnpm vitest run apps/server/scripts/smoke-test-vision.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import sharp from "sharp";
import { analyzeImage } from "../src/services/vision.js";

const run = process.env.RUN_CLIP_SMOKE === "1";
const maybe = run ? it : it.skip;

describe("vision smoke (live)", () => {
  beforeEach(() => {
    layer("integration");
    epic("Ingest");
    feature("Vision Smoke");
  });

  maybe(
    "OCRs a text image",
    async () => {
      const svg = `<svg width="600" height="200"><rect width="600" height="200" fill="white"/><text x="20" y="110" font-size="48" fill="black">Cliphy OCR test</text></svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const r = await analyzeImage(png, "image/png");
      expect(r.extractedText.toLowerCase()).toContain("cliphy");
    },
    30_000,
  );

  maybe(
    "describes a plain image",
    async () => {
      const png = await sharp({
        create: { width: 400, height: 400, channels: 3, background: { r: 20, g: 120, b: 200 } },
      })
        .png()
        .toBuffer();
      const r = await analyzeImage(png, "image/png");
      expect(r.description.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
