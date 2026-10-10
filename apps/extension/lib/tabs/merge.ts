import { MAX_KEYWORDS_PER_TAG, normalizeKeywords } from "@cliphy/shared";

// Merging one group into another in the Tabs view. Tabs move (as Move-to
// overrides); for tag → tag, the source's keywords/hints join the target's and
// the source tag becomes a local alias of the target, so anything still
// classified as the old tag shows under the new one. Saved clips are untouched.

export const TAG_ALIASES_KEY = "tabs:tagAliases"; // storage.local: { from: to }

export type DropZone = "before" | "merge" | "after";

/**
 * Where a drag over a group header lands: the outer quarters reorder, the
 * middle half merges (when merging is allowed for this pair).
 */
export function dropZone(
  clientY: number,
  top: number,
  height: number,
  canMerge: boolean,
): DropZone {
  const f = height > 0 ? (clientY - top) / height : 0;
  if (canMerge && f >= 0.25 && f <= 0.75) return "merge";
  return f < 0.5 ? "before" : "after";
}

/** Target keeps its own first; source's keywords/hints are appended (deduped, capped). */
export function combineMeta(
  target: { hints: string; keywords: string[] },
  source: { hints: string; keywords: string[] },
): { hints: string; keywords: string[] } {
  const hints = [target.hints.trim(), source.hints.trim()]
    .filter(Boolean)
    .filter((h, i, all) => all.indexOf(h) === i)
    .join("; ")
    .slice(0, 500);
  const keywords = normalizeKeywords([...target.keywords, ...source.keywords]).slice(
    0,
    MAX_KEYWORDS_PER_TAG,
  );
  return { hints, keywords };
}

/** Follow merged-tag aliases (ai → design → studio); stops on cycles. */
export function resolveAlias(tag: string, aliases: Record<string, string>): string {
  const seen = new Set<string>([tag]);
  let current = tag;
  while (aliases[current] && !seen.has(aliases[current])) {
    current = aliases[current];
    seen.add(current);
  }
  return current;
}

export async function loadTagAliases(): Promise<Record<string, string>> {
  try {
    const r = await browser.storage.local.get(TAG_ALIASES_KEY);
    const v = r?.[TAG_ALIASES_KEY];
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function saveTagAliases(aliases: Record<string, string>): Promise<void> {
  await browser.storage.local.set({ [TAG_ALIASES_KEY]: aliases });
}
