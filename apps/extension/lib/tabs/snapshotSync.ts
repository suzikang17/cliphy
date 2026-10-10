import type { Tabs } from "wxt/browser";
import { closeGroupSnapshot, resumeGroup as deleteGroupSnapshot } from "../api";
import { isAuthenticated } from "../auth";
import { normalizeUrl } from "./dedupe";
import { loadSnapshots, pruneClosedPage, saveSnapshots, type Snapshots } from "./groupSnapshots";

/** Send changed snapshots to the server and delete removed ones. Returns the keys that failed. */
export async function pushSnapshots(snaps: Snapshots, keys: string[]): Promise<string[]> {
  if (keys.length === 0 || !(await isAuthenticated().catch(() => false))) return keys;
  const failed: string[] = [];
  for (const key of keys) {
    const s = snaps[key];
    try {
      if (s) await closeGroupSnapshot(s.key, s.label, s.pages);
      else await deleteGroupSnapshot(key);
    } catch {
      if (s) failed.push(key); // a delete of a row the server doesn't have is fine to drop
    }
  }
  return failed;
}

/**
 * Background: a tab was closed. If you closed it on purpose (not its window
 * closing or the browser quitting) and the page isn't open elsewhere, it
 * leaves its group's snapshot.
 */
export async function onPageClosed(url: string, tabId: number): Promise<void> {
  const key = normalizeUrl(url);
  if (!key) return;
  const open = (await browser.tabs.query({})) as Tabs.Tab[];
  if (open.some((t) => t.id !== tabId && !!t.url && normalizeUrl(t.url) === key)) return;
  const { next, changed, removed } = pruneClosedPage(await loadSnapshots(), url);
  if (changed.length === 0 && removed.length === 0) return;
  await saveSnapshots(next);
  await pushSnapshots(next, [...changed, ...removed]);
}
