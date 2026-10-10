import type { TabGroup } from "./organize";
import type { OpenTab } from "./types";

/** Case-insensitive substring match over title + URL. */
export function matchesQuery(tab: Pick<OpenTab, "title" | "url">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q);
}

/** Groups with only matching rows; empty groups dropped. */
export function filterGroups(groups: TabGroup[], query: string): TabGroup[] {
  if (!query.trim()) return groups;
  return groups
    .map((g) => ({ ...g, tabs: g.tabs.filter((t) => matchesQuery(t, query)) }))
    .filter((g) => g.tabs.length > 0);
}

/**
 * Rows in on-screen order — the keyboard selection walks this list. Collapsed
 * groups are skipped unless searching (a search shows every match).
 */
export function visibleRows(groups: TabGroup[], collapsed: Set<string>, query: string): OpenTab[] {
  const searching = !!query.trim();
  return groups.flatMap((g) => (searching || !collapsed.has(g.key) ? g.tabs : []));
}

/** ↑/↓: move the selection, clamped to the list. -1 means "nothing selected". */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length === 0) return -1;
  if (index < 0) return delta > 0 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, index + delta));
}

/** Enter: the selected row, or the top match when nothing is selected. */
export function rowToActivate(rows: OpenTab[], index: number): OpenTab | null {
  if (rows.length === 0) return null;
  return rows[index >= 0 && index < rows.length ? index : 0] ?? null;
}
