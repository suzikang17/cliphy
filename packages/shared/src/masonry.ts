import type { Summary } from "./types";

// Rough relative card heights used only to balance columns. Units are
// arbitrary "estimated points"; only the ratios matter.
//
// Card media is capped + cropped (CARD_MEDIA `max-h-52` ≈ 208px), so media
// contributes a roughly constant height regardless of source aspect ratio —
// estimating per-aspect (e.g. tall image = +220) diverges from the real capped
// height and makes columns ragged. Model it as: base + (media?) + (body?).
export function heightEstimate(clip: Summary): number {
  const base = 96; // frame + up-to-2-line title + meta line
  const meta = (clip.sourceMetadata ?? {}) as { media?: unknown[] };
  const hasMedia =
    clip.sourceType === "youtube" ||
    (clip.sourceType === "tweet"
      ? Array.isArray(meta.media) && meta.media.length > 0
      : Boolean(clip.heroImageUrl));
  const media = hasMedia ? 176 : 0; // capped media reads ~constant
  const body = clip.excerpt || clip.content ? 44 : 0;
  return base + media + body;
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
