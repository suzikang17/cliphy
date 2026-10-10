import { normalizeUrl, type ClosedGroup, type ClosedGroupPage } from "@cliphy/shared";
import type { TabGroup } from "./organize";

// Autosaved tag groups. While a tag group's tabs are open, its pages are kept
// in a snapshot. A page leaves the snapshot only when you close it on purpose
// (x, Close all, Stow); pages that vanish with a window or a browser quit
// stay. A snapshot with none of its pages open is a closed group you can
// Resume. ⇧C marks a group closed, so closing its tabs keeps every page.
// Address + title only, like the rest of the Tabs view.

export const SNAPSHOTS_KEY = "tabs:groupSnapshots"; // storage.local
/** The server accepts up to 100 pages per group. */
export const MAX_SNAPSHOT_PAGES = 100;

export interface Snapshot {
  key: string;
  label: string;
  pages: ClosedGroupPage[];
  updatedAt: number;
  /** Set by ⇧C: closing its tabs keeps the pages. Cleared when the group is open again. */
  closedAt?: number;
}
export type Snapshots = Record<string, Snapshot>;

interface Change {
  next: Snapshots;
  /** Keys whose snapshot changed (to send to the server). */
  changed: string[];
  /** Keys whose snapshot was removed. */
  removed: string[];
}

const pageKey = (url: string) => normalizeUrl(url) ?? url;
const sameKeys = (a: ClosedGroupPage[], b: ClosedGroupPage[]) => {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((p) => pageKey(p.url)));
  return b.every((p) => set.has(pageKey(p.url)));
};

/** Fold the open tag groups into their snapshots: open pages first, then the ones kept from before. */
export function autosave(snaps: Snapshots, groups: TabGroup[], now: number): Change {
  const next: Snapshots = { ...snaps };
  const changed: string[] = [];
  for (const g of groups) {
    if (g.kind !== "tag" || g.tabs.length === 0) continue;
    const prev = snaps[g.key];
    const seen = new Set<string>();
    const pages: ClosedGroupPage[] = [];
    const add = (p: ClosedGroupPage) => {
      const k = pageKey(p.url);
      if (seen.has(k)) return;
      seen.add(k);
      pages.push(p);
    };
    for (const t of g.tabs) add({ url: t.url, title: t.customTitle || t.title || t.url });
    for (const p of prev?.pages ?? []) add(p);
    const capped = pages.slice(0, MAX_SNAPSHOT_PAGES);
    if (
      prev &&
      prev.closedAt === undefined &&
      prev.label === g.label &&
      sameKeys(prev.pages, capped)
    ) {
      continue;
    }
    next[g.key] = { key: g.key, label: g.label, pages: capped, updatedAt: now };
    changed.push(g.key);
  }
  return { next, changed, removed: [] };
}

/** You closed this page on purpose: drop it from every snapshot that isn't closed. */
export function pruneClosedPage(snaps: Snapshots, url: string): Change {
  const k = pageKey(url);
  const next: Snapshots = { ...snaps };
  const changed: string[] = [];
  const removed: string[] = [];
  for (const s of Object.values(snaps)) {
    if (s.closedAt !== undefined) continue;
    const pages = s.pages.filter((p) => pageKey(p.url) !== k);
    if (pages.length === s.pages.length) continue;
    if (pages.length === 0) {
      delete next[s.key];
      removed.push(s.key);
    } else {
      next[s.key] = { ...s, pages, updatedAt: Date.now() };
      changed.push(s.key);
    }
  }
  return { next, changed, removed };
}

/** ⇧C: keep every page when its tabs close. */
export function markClosed(snaps: Snapshots, key: string, now: number): Snapshots {
  const s = snaps[key];
  return s ? { ...snaps, [key]: { ...s, closedAt: now } } : snaps;
}

export function markResumed(snaps: Snapshots, key: string): Snapshots {
  const s = snaps[key];
  if (!s) return snaps;
  const rest = { ...s };
  delete rest.closedAt;
  return { ...snaps, [key]: rest };
}

/** Closed groups: snapshots with none of their pages open, newest first. */
export function closedView(snaps: Snapshots, openUrls: string[]): ClosedGroup[] {
  const open = new Set(openUrls.map(pageKey));
  return Object.values(snaps)
    .filter((s) => s.pages.length > 0 && !s.pages.some((p) => open.has(pageKey(p.url))))
    .map((s) => ({
      key: s.key,
      label: s.label,
      pages: s.pages,
      closedAt: new Date(s.closedAt ?? s.updatedAt).toISOString(),
    }))
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt));
}

export async function loadSnapshots(): Promise<Snapshots> {
  try {
    const v = (await browser.storage.local.get(SNAPSHOTS_KEY))?.[SNAPSHOTS_KEY];
    return v && typeof v === "object" ? (v as Snapshots) : {};
  } catch {
    return {};
  }
}

export async function saveSnapshots(snaps: Snapshots): Promise<void> {
  try {
    await browser.storage.local.set({ [SNAPSHOTS_KEY]: snaps });
  } catch {
    // best-effort
  }
}
