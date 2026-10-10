import { tagPath, type TrailItem } from "@cliphy/shared";

export interface TrailGroup {
  /** The first tag, or "" for untagged items. */
  key: string;
  label: string;
  items: TrailItem[];
}

export const OTHER_LABEL = "Other";

/**
 * Group trail items by their first tag, keeping the server's newest-first order
 * inside each group. Groups appear in order of their newest item; untagged
 * items go last under "Other".
 */
export function groupTrail(items: TrailItem[]): TrailGroup[] {
  const byTag = new Map<string, TrailItem[]>();
  for (const item of items) {
    const key = item.tags[0] ?? "";
    byTag.set(key, [...(byTag.get(key) ?? []), item]);
  }
  const groups = [...byTag.entries()].map(([key, list]) => ({
    key,
    label: key ? tagPath(key).join(" › ") : OTHER_LABEL,
    items: list,
  }));
  return [...groups.filter((g) => g.key), ...groups.filter((g) => !g.key)];
}

/** Rows in on-screen order — the keyboard selection walks this list. */
export function trailRows(groups: TrailGroup[]): TrailItem[] {
  return groups.flatMap((g) => g.items);
}
