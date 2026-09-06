import type { Summary } from "./types";

// Rough relative card heights used only to balance columns. Units are
// arbitrary "estimated points"; only the ratios matter.
export function heightEstimate(clip: Summary): number {
  const base = 90; // frame + title + meta
  const meta = (clip.sourceMetadata ?? {}) as { media?: unknown[]; kind?: string };
  switch (clip.sourceType) {
    case "image":
      return base + (clip.heroImageUrl ? 220 : 40);
    case "tweet":
      return base + (Array.isArray(meta.media) && meta.media.length ? 200 : 40);
    case "web":
      return base + (clip.heroImageUrl ? 150 : 0) + (clip.excerpt ? 30 : 0);
    case "youtube":
      return base + 80; // thumbnail
    case "podcast":
      return base + (clip.excerpt ? 30 : 0);
    default:
      return base;
  }
}

/**
 * Greedy shortest-column bin-packing. Each item joins whichever column
 * currently has the smallest running estimated height, preserving feed order
 * within a column. Two columns suits a phone; a wide new tab passes 4-5.
 */
export function splitColumns(items: Summary[], columns = 2): Summary[][] {
  const count = Math.max(1, Math.floor(columns));
  const cols: Summary[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    let target = 0;
    for (let i = 1; i < count; i++) {
      if (heights[i] < heights[target]) target = i;
    }
    cols[target].push(item);
    heights[target] += heightEstimate(item);
  }
  return cols;
}
