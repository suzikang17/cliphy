import type { TabCluster } from "@cliphy/shared";
import type { Activity } from "./activity";

// Infers which open tabs the user is working on together, from behavior alone
// (no AI, no content). Pure and deterministic: the same input gives the same
// output. The result goes to the organizer as grouping evidence — e.g. a Stripe
// invoice and a client's Drive folder share no words but were opened together
// and used side by side.

export interface ClusterTab {
  id: number;
  windowId: number;
  openedAt?: number;
  lastAccessed: number;
}

const MIN = 60_000;
/** Consecutive switches further apart than this don't count as "side by side". */
export const SWITCH_GAP_MS = 5 * MIN;
/** Direct switches between two tabs needed for a strong edge. */
export const SWITCH_PAIR_MIN = 3;
/** Same-window tabs opened within this window are weakly linked. */
export const OPENED_TOGETHER_MS = 2 * MIN;
/** Weak edges may not grow a cluster past this, so steady browsing doesn't chain into one blob. */
export const WEAK_CLUSTER_CAP = 8;
export const MIN_CLUSTER = 2;
export const MAX_CLUSTER = 12;

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

class UnionFind {
  private parent = new Map<number, number>();
  private size = new Map<number, number>();

  constructor(ids: number[]) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.size.set(id, 1);
    }
  }

  find(x: number): number {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (x !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }

  sizeOf(x: number): number {
    return this.size.get(this.find(x))!;
  }

  union(a: number, b: number): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    // Deterministic: the smaller id becomes the root on ties.
    if (
      this.size.get(ra)! < this.size.get(rb)! ||
      (this.size.get(ra) === this.size.get(rb) && rb < ra)
    ) {
      [ra, rb] = [rb, ra];
    }
    this.parent.set(rb, ra);
    this.size.set(ra, this.size.get(ra)! + this.size.get(rb)!);
  }
}

export function buildClusters(tabs: ClusterTab[], activity: Activity, now: number): TabCluster[] {
  const byId = new Map<number, ClusterTab>();
  for (const t of tabs) byId.set(t.id, t);
  const ids = [...byId.keys()].sort((a, b) => a - b);
  const uf = new UnionFind(ids);

  // Switch log, restricted to the past and in time order.
  const switches = activity.switches.filter((s) => s.at <= now).sort((a, b) => a.at - b.at);

  // ── Strong: opener links ──
  const openerPairs = new Set<string>();
  for (const [childStr, opener] of Object.entries(activity.openers)) {
    const child = Number(childStr);
    if (child === opener || !byId.has(child) || !byId.has(opener)) continue;
    openerPairs.add(pairKey(child, opener));
    uf.union(child, opener);
  }

  // ── Strong: repeated direct switches (both directions, ≤ 5 min apart) ──
  const pairSwitches = new Map<string, number>();
  for (let i = 1; i < switches.length; i++) {
    const a = switches[i - 1];
    const b = switches[i];
    if (a.tabId === b.tabId || b.at - a.at > SWITCH_GAP_MS) continue;
    if (!byId.has(a.tabId) || !byId.has(b.tabId)) continue;
    const key = pairKey(a.tabId, b.tabId);
    pairSwitches.set(key, (pairSwitches.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...pairSwitches].sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (count < SWITCH_PAIR_MIN) continue;
    const [a, b] = key.split(":").map(Number);
    uf.union(a, b);
  }

  // ── Weak: opened together in the same window (capped chaining) ──
  const weak: { a: number; b: number; gap: number }[] = [];
  const opened = ids
    .map((id) => byId.get(id)!)
    .filter((t) => typeof t.openedAt === "number")
    .sort((x, y) => x.openedAt! - y.openedAt! || x.id - y.id);
  for (let i = 0; i < opened.length; i++) {
    for (let j = i + 1; j < opened.length; j++) {
      const gap = opened[j].openedAt! - opened[i].openedAt!;
      if (gap > OPENED_TOGETHER_MS) break;
      if (opened[i].windowId !== opened[j].windowId) continue;
      const [a, b] =
        opened[i].id < opened[j].id ? [opened[i].id, opened[j].id] : [opened[j].id, opened[i].id];
      weak.push({ a, b, gap });
    }
  }
  weak.sort((x, y) => x.gap - y.gap || x.a - y.a || x.b - y.b);
  for (const { a, b } of weak) {
    if (uf.find(a) === uf.find(b)) continue;
    if (uf.sizeOf(a) + uf.sizeOf(b) > WEAK_CLUSTER_CAP) continue;
    uf.union(a, b);
  }

  // ── Collect components ──
  const groups = new Map<number, number[]>();
  for (const id of ids) {
    const root = uf.find(id);
    const list = groups.get(root);
    if (list) list.push(id);
    else groups.set(root, [id]);
  }

  const firstSwitch = new Map<number, number>();
  const lastSwitch = new Map<number, number>();
  for (const s of switches) {
    if (!firstSwitch.has(s.tabId)) firstSwitch.set(s.tabId, s.at);
    lastSwitch.set(s.tabId, s.at);
  }

  const clusters: TabCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < MIN_CLUSTER || members.length > MAX_CLUSTER) continue;
    const inCluster = new Set(members);

    let start = Infinity;
    let end = -Infinity;
    for (const id of members) {
      const t = byId.get(id)!;
      const s =
        t.openedAt ?? firstSwitch.get(id) ?? (t.lastAccessed > 0 ? t.lastAccessed : undefined);
      if (s !== undefined) start = Math.min(start, s);
      end = Math.max(end, t.lastAccessed, lastSwitch.get(id) ?? -Infinity);
    }

    let switchCount = 0;
    for (let i = 1; i < switches.length; i++) {
      const a = switches[i - 1].tabId;
      const b = switches[i].tabId;
      if (a !== b && inCluster.has(a) && inCluster.has(b)) switchCount++;
    }
    let openerLinks = 0;
    for (const key of openerPairs) {
      const [a, b] = key.split(":").map(Number);
      if (inCluster.has(a) && inCluster.has(b)) openerLinks++;
    }

    clusters.push({
      keys: members.map(String),
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : 0,
      switches: switchCount,
      openerLinks,
    });
  }

  const strength = (c: TabCluster) => c.switches + 2 * c.openerLinks;
  return clusters.sort(
    (x, y) =>
      strength(y) - strength(x) ||
      y.keys.length - x.keys.length ||
      Number(x.keys[0]) - Number(y.keys[0]),
  );
}
