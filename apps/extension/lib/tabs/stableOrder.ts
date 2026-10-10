import type { TabGroup } from "./organize";

// Keeps the Tabs view still while you use it: the order things first appeared
// in sticks for as long as the panel is open. Clicking a tab (which makes it
// "most recent") no longer jumps it or its group to the top. New tabs and new
// groups appear at the top, newest first.

export interface OrderMemo {
  pos: Map<string, number>;
  /** Next position for a newcomer: counts down, so newer sorts first. */
  top: number;
  seeded: boolean;
  groupsSeeded: boolean;
}

export const createOrderMemo = (): OrderMemo => ({
  pos: new Map(),
  top: -1,
  seeded: false,
  groupsSeeded: false,
});

/** You reordered groups yourself (or reset): take the group order fresh next time. */
export function reseedGroups(memo: OrderMemo): void {
  for (const k of [...memo.pos.keys()]) if (k.startsWith("g:")) memo.pos.delete(k);
  memo.groupsSeeded = false;
}

export function stableOrder(groups: TabGroup[], memo: OrderMemo): TabGroup[] {
  const place = (id: string, initial: number) => {
    let p = memo.pos.get(id);
    if (p === undefined) {
      const seeded = id.startsWith("g:") ? memo.groupsSeeded : memo.seeded;
      p = seeded ? memo.top-- : initial;
      memo.pos.set(id, p);
    }
    return p;
  };
  let i = 0;
  // Seed (or extend) positions in the freshly sorted order.
  for (const g of groups) {
    place(`g:${g.key}`, i++);
    for (const t of g.tabs) place(`t:${t.id}`, i++);
  }
  // Only a pass that actually had tabs sets the baseline (the first one may run before they load).
  if (groups.some((g) => g.tabs.length > 0)) {
    memo.seeded = true;
    memo.groupsSeeded = true;
  }
  const at = (id: string) => memo.pos.get(id) ?? 0;
  return groups
    .map((g) => ({ ...g, tabs: [...g.tabs].sort((a, b) => at(`t:${a.id}`) - at(`t:${b.id}`)) }))
    .sort((a, b) => at(`g:${a.key}`) - at(`g:${b.key}`));
}
