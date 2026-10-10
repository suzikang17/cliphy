import type { OpenTab } from "./types";

/** Query params that only track where a click came from — never part of page identity. */
const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^si$/i, /^ref$/i, /^ref_src$/i];

/**
 * Page identity for duplicate detection: lowercase host without `www.`, no
 * `#hash`, no trailing slash (except root), tracking params stripped, remaining
 * params sorted. Meaningful params stay (youtube ?v=A ≠ ?v=B). null for non-web.
 */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.some((re) => re.test(k)))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${path}${query}`;
}

/** Sets of tabs showing the same page (2+ copies each). */
export function findDuplicates(tabs: OpenTab[]): OpenTab[][] {
  const byPage = new Map<string, OpenTab[]>();
  for (const t of tabs) {
    const key = normalizeUrl(t.url);
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
  const key = normalizeUrl(newTab.url);
  if (!key || bypass.includes(key)) return { action: "none" };

  const copies = allTabs.filter((t) => t.id !== newTab.id && normalizeUrl(t.url) === key);
  if (copies.length === 0) return { action: "none" };

  const existing = copies.reduce((best, t) => (t.lastAccessed > best.lastAccessed ? t : best));
  return newTab.active ? { action: "switch", existing } : { action: "closeQuietly", existing };
}
