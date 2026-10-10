import type { GroupKey, TabGroup } from "./organize";

// Manual group order for the Tabs view. Groups you've placed (by drag or ⌥↑/↓)
// stay pinned at the top in your order; groups you haven't placed keep the
// automatic order below them. "Probably done" is always last. Order is stored
// locally only — no network.

export const GROUP_ORDER_KEY = "tabs:groupOrder"; // storage.local

const DONE: GroupKey = "done";

export function applyGroupOrder(groups: TabGroup[], order: GroupKey[]): TabGroup[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const placed = order
    .filter((k) => k !== DONE)
    .map((k) => byKey.get(k))
    .filter((g): g is TabGroup => !!g);
  const placedKeys = new Set(placed.map((g) => g.key));
  const rest = groups.filter((g) => !placedKeys.has(g.key) && g.key !== DONE);
  const done = byKey.get(DONE);
  return [...placed, ...rest, ...(done ? [done] : [])];
}

/**
 * Remember the new order after moving `from` to `position` of `target` in the
 * visible list. Placed afterwards: every group from the top through whichever
 * of the moved group and its target is lower (you arranged those on purpose),
 * plus any group you'd already placed. Groups below keep their automatic order.
 * Placed groups that aren't open right now keep their remembered spot.
 */
export function reorderGroups(
  visible: GroupKey[],
  order: GroupKey[],
  from: GroupKey,
  target: GroupKey,
  position: "before" | "after",
): GroupKey[] {
  if (from === target || from === DONE || target === DONE) return order;
  const list = visible.filter((k) => k !== DONE && k !== from);
  const at = list.indexOf(target);
  if (at === -1) return order;
  const insertAt = position === "before" ? at : at + 1;
  list.splice(insertAt, 0, from);
  const through = Math.max(list.indexOf(from), list.indexOf(target));
  const wasPlaced = new Set(order);
  const placed = list.filter((k, i) => i <= through || wasPlaced.has(k));
  return withRemembered(placed, visible, order);
}

/** Move a group up (-1) or down (+1) one place. */
export function nudgeGroup(
  visible: GroupKey[],
  order: GroupKey[],
  key: GroupKey,
  dir: -1 | 1,
): GroupKey[] {
  const list = visible.filter((k) => k !== DONE);
  const i = list.indexOf(key);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= list.length) return order;
  return reorderGroups(visible, order, key, list[j], dir < 0 ? "before" : "after");
}

/** New placed prefix + previously placed groups that aren't on screen right now. */
function withRemembered(placed: GroupKey[], visible: GroupKey[], order: GroupKey[]): GroupKey[] {
  const onScreen = new Set(visible);
  const kept = order.filter((k) => !onScreen.has(k) && !placed.includes(k));
  return [...placed, ...kept];
}

export async function loadGroupOrder(): Promise<GroupKey[]> {
  try {
    const r = await browser.storage.local.get(GROUP_ORDER_KEY);
    const v = r?.[GROUP_ORDER_KEY];
    return Array.isArray(v) ? (v as GroupKey[]) : [];
  } catch {
    return [];
  }
}

export async function saveGroupOrder(order: GroupKey[]): Promise<void> {
  await browser.storage.local.set({ [GROUP_ORDER_KEY]: order });
}
