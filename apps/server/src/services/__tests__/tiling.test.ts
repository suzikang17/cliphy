import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import sharp from "sharp";
import { tileImage, imageSize } from "../tiling.js";

async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

describe("tiling", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Tiling");
  });

  it("reports image size", async () => {
    const buf = await makeImage(300, 900);
    expect(await imageSize(buf)).toEqual({ width: 300, height: 900 });
  });

  it("splits a tall image into multiple tiles", async () => {
    const buf = await makeImage(300, 2400);
    const tiles = await tileImage(buf, 1000);
    expect(tiles.length).toBeGreaterThan(1);
    const first = await imageSize(tiles[0]);
    expect(first.width).toBe(300);
  });

  it("returns a single tile for a short image", async () => {
    const buf = await makeImage(300, 600);
    const tiles = await tileImage(buf, 1000);
    expect(tiles.length).toBe(1);
  });
});
