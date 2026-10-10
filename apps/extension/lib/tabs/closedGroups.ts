import { normalizeUrl, type ClosedGroupPage } from "@cliphy/shared";
import type { TabGroup } from "./organize";
import type { PagePin } from "./pins";

// Helpers for closed groups: what Resume reopens, header counts, a group's pins.
// The snapshots themselves live in groupSnapshots.ts.

/** Resume opens a new window when more pages than this would open. */
export const NEW_WINDOW_ABOVE = 8;

const key = (url: string) => normalizeUrl(url) ?? url;

/** The pins that belong to a group: tagged with its tag. Non-tag groups have none. */
export function pinsForGroup(pins: PagePin[], groupKey: string): PagePin[] {
  if (!groupKey.startsWith("tag:")) return [];
  const tag = groupKey.slice(4);
  return pins.filter((p) => p.tags?.includes(tag));
}

/** snapshot ∪ pinned, minus pages already open, one per page, snapshot first. */
export function pagesToResume(
  snapshot: ClosedGroupPage[],
  pinned: PagePin[],
  openUrls: string[],
): ClosedGroupPage[] {
  const open = new Set(openUrls.map(key));
  const seen = new Set<string>();
  const out: ClosedGroupPage[] = [];
  for (const p of [...snapshot, ...pinned.map((x) => ({ url: x.url, title: x.title }))]) {
    const k = key(p.url);
    if (open.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function groupCounts(
  group: TabGroup,
  pins: PagePin[],
  trailCount: number,
): { open: number; pinned: number; trail: number } {
  const pinnedKeys = new Set(pins.map((p) => p.key));
  return {
    open: group.tabs.length,
    pinned: group.tabs.filter((t) => pinnedKeys.has(key(t.url))).length,
    trail: trailCount,
  };
}

/** Trail items per first tag — the "N in trail" on group headers. */
export function countByFirstTag(items: { tags: string[] }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items) {
    const t = i.tags[0];
    if (t) out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}
