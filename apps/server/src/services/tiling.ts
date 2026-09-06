// `sharp` is a native module. The Vercel API bundle is a single esbuild file with
// no node_modules at runtime, so sharp cannot be bundled there — it is marked
// external in scripts/build-vercel.sh and loaded lazily here. When it is absent
// (serverless) we degrade gracefully: no tiling, unknown size. Claude vision then
// processes the whole image (only very-tall-screenshot legibility is reduced).
// sharp runs where it is installed (local dev, tests, or a future VPS worker).
type SharpFactory = typeof import("sharp").default;

let sharpMod: SharpFactory | null | undefined;
async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpMod !== undefined) return sharpMod;
  try {
    sharpMod = (await import("sharp")).default;
  } catch {
    sharpMod = null;
  }
  return sharpMod;
}

export async function imageSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  const sharp = await loadSharp();
  if (!sharp) return { width: 0, height: 0 };
  const meta = await sharp(bytes).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

// Split a tall image into vertical tiles of at most `tileHeight` px, with a
// small overlap so text spanning a cut isn't lost. Returns a single tile when
// the image is short enough or when sharp is unavailable.
export async function tileImage(bytes: Buffer, tileHeight = 1500): Promise<Buffer[]> {
  const sharp = await loadSharp();
  if (!sharp) return [bytes];
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
