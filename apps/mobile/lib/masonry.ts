import type { Summary } from "@cliphy/shared";

// Rough relative card heights used only to balance the two columns. Units are
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

// Greedy shortest-column bin-packing. Each item joins whichever column currently
// has the smaller running estimated height, preserving feed order within a column.
export function splitColumns(items: Summary[]): [Summary[], Summary[]] {
  const cols: [Summary[], Summary[]] = [[], []];
  const heights = [0, 0];
  for (const item of items) {
    const target = heights[0] <= heights[1] ? 0 : 1;
    cols[target].push(item);
    heights[target] += heightEstimate(item);
  }
  return cols;
}
