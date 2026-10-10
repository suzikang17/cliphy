import type { OpenTab } from "./types";

// Page identity lives in @cliphy/shared so the server's page_tags agree with it.
export { normalizeUrl } from "@cliphy/shared";
import { normalizeUrl } from "@cliphy/shared";

/**
 * Which page a tab shows, for duplicate detection: the normalized address, plus
 * the #fragment when it's an app route (Gmail's #inbox/<id>, #/settings, #!/x),
 * since those are different views. A plain #anchor is the same page.
 */
export function dedupeKey(url: string): string | null {
  const key = normalizeUrl(url);
  if (!key) return null;
  let hash: string;
  try {
    hash = new URL(url).hash;
  } catch {
    return key;
  }
  return /^#(\/|!|[^#]*\/)/.test(hash) ? key + hash : key;
}

/** Sets of tabs showing the same page (2+ copies each). */
export function findDuplicates(tabs: OpenTab[]): OpenTab[][] {
  const byPage = new Map<string, OpenTab[]>();
  for (const t of tabs) {
    const key = dedupeKey(t.url);
    if (!key) continue;
    byPage.set(key, [...(byPage.get(key) ?? []), t]);
  }
  return [...byPage.values()].filter((list) => list.length > 1);
}

/** The copy to keep: the active tab if any, else the most recently viewed. */
export function pickKeeper(copies: OpenTab[]): OpenTab {
  return copies.reduce((best, t) => {
    if (t.active !== best.active) return t.active ? t : best;
    return t.lastAccessed > best.lastAccessed ? t : best;
  });
}

export type InterceptDecision =
  | { action: "none" }
  | { action: "switch"; existing: OpenTab }
  | { action: "closeQuietly"; existing: OpenTab };

/**
 * A newly opened tab just landed on `newTab.url`. If that page is already open
 * elsewhere: a foreground tab → switch to the existing copy (and close the new
 * one); a background tab (⌘/middle-click) → close it quietly, stay put.
 * `bypass` = normalized URLs the user explicitly reopened via Undo.
 */
export function decideIntercept({
  newTab,
  allTabs,
  enabled,
  bypass,
}: {
  newTab: OpenTab;
  allTabs: OpenTab[];
  enabled: boolean;
  bypass: string[];
}): InterceptDecision {
  if (!enabled) return { action: "none" };
  const key = dedupeKey(newTab.url);
  if (!key || bypass.includes(key)) return { action: "none" };

  const copies = allTabs.filter((t) => t.id !== newTab.id && dedupeKey(t.url) === key);
  if (copies.length === 0) return { action: "none" };

  const existing = copies.reduce((best, t) => (t.lastAccessed > best.lastAccessed ? t : best));
  return newTab.active ? { action: "switch", existing } : { action: "closeQuietly", existing };
}

/** Tab ids to close so each page is open once (keeps the active / most recently viewed copy). */
export function duplicateIdsToClose(tabs: OpenTab[]): number[] {
  return findDuplicates(tabs).flatMap((copies) => {
    const keep = pickKeeper(copies);
    return copies.filter((t) => t.id !== keep.id).map((t) => t.id);
  });
}

export interface NestedTab {
  /** The copy you keep (active / most recently viewed). */
  parent: OpenTab;
  /** Other copies of the same page — what "close dupes" closes. */
  children: OpenTab[];
}

/** Within one group: copies of a page nest under their keeper, placed where the page first appears. */
export function nestDuplicates(tabs: OpenTab[]): NestedTab[] {
  const byPage = new Map<string, OpenTab[]>();
  const order: string[] = [];
  for (const t of tabs) {
    const key = dedupeKey(t.url) ?? `id:${t.id}`;
    if (!byPage.has(key)) {
      byPage.set(key, []);
      order.push(key);
    }
    byPage.get(key)!.push(t);
  }
  return order.map((key) => {
    const copies = byPage.get(key)!;
    const parent = pickKeeper(copies);
    return { parent, children: copies.filter((t) => t.id !== parent.id) };
  });
}
