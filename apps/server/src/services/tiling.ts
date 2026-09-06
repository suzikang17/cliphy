import sharp from "sharp";

export async function imageSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

// Split a tall image into vertical tiles of at most `tileHeight` px, with a
// small overlap so text spanning a cut isn't lost. Returns a single tile when
// the image is short enough.
export async function tileImage(bytes: Buffer, tileHeight = 1500): Promise<Buffer[]> {
  const { width, height } = await imageSize(bytes);
  if (!width || !height || height <= tileHeight) return [bytes];

  const overlap = 100;
  const tiles: Buffer[] = [];
  let top = 0;
  while (top < height) {
    const h = Math.min(tileHeight, height - top);
    const tile = await sharp(bytes).extract({ left: 0, top, width, height: h }).jpeg().toBuffer();
    tiles.push(tile);
    if (top + h >= height) break;
    top += tileHeight - overlap;
  }
  return tiles;
}
