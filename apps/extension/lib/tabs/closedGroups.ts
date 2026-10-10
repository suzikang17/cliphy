import { normalizeUrl, type ClosedGroup, type ClosedGroupPage } from "@cliphy/shared";
import type { TabGroup } from "./organize";
import type { PagePin } from "./pins";

// Durable groups: a group can be closed as a whole (its open pages are
// snapshotted) and resumed later. Snapshots live on the server; a local copy
// is the fallback when the server can't be reached (the Trail is the guarantee
// that nothing is lost either way).

export const CLOSED_GROUPS_KEY = "tabs:closedGroups"; // storage.local
/** Resume opens a new window when more pages than this would open. */
export const NEW_WINDOW_ABOVE = 8;

const key = (url: string) => normalizeUrl(url) ?? url;

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

export async function cacheClosedGroups(groups: ClosedGroup[]): Promise<void> {
  try {
    await browser.storage.local.set({ [CLOSED_GROUPS_KEY]: groups });
  } catch {
    // best-effort
  }
}

export async function loadCachedClosedGroups(): Promise<ClosedGroup[]> {
  try {
    const r = await browser.storage.local.get(CLOSED_GROUPS_KEY);
    const v = r?.[CLOSED_GROUPS_KEY];
    return Array.isArray(v) ? (v as ClosedGroup[]) : [];
  } catch {
    return [];
  }
}
