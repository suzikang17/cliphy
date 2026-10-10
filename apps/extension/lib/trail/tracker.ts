import type { Tabs } from "wxt/browser";
import type { TrailCaptureItem } from "@cliphy/shared";
import { captureTrail } from "../api";
import { isAuthenticated } from "../auth";
import { normalizeUrl } from "../tabs/dedupe";
import { getTabMeta } from "../tabs/tabMeta";
import { loadOpenedTimes } from "../tabs/openedAt";
import { isWebUrl } from "../tabs/types";
import { shouldTrail } from "./rules";

// Background-side trail capture. `tabs.onRemoved` only hands us a tab id, so we
// keep what each tab shows (URL, title, open time) as it changes — in memory,
// mirrored to storage.session because the service worker sleeps. Closing a tab
// does no page reading and no awaiting on the network: it queues an item, and
// the queue is flushed in one fire-and-forget batch a moment later.

export const TRAIL_ENABLED_KEY = "trail:enabled"; // storage.local; on unless explicitly false
/** Set once the first-run notice has been answered (Keep / Turn off). */
export const TRAIL_NOTICE_KEY = "trail:noticeSeen";
const TAB_PREFIX = "trail:tab:"; // storage.session, tabId → TrackedTab
const QUEUE_KEY = "trail:queue"; // storage.session, captures not yet sent
/** Sent to extension pages after a batch is saved, so an open panel can refresh. */
export const TRAIL_SAVED_MESSAGE = "TRAIL_SAVED";

export const FLUSH_DEBOUNCE_MS = 2000;
export const MAX_TRAIL_BATCH = 50;
/** A batch that fails is retried once on the next flush, then dropped. */
const MAX_ATTEMPTS = 2;

interface TrackedTab {
  url: string;
  title: string;
  openedAt?: number;
}

interface PendingCapture extends TrailCaptureItem {
  attempts: number;
}

export async function isTrailEnabled(): Promise<boolean> {
  const r = await browser.storage.local.get(TRAIL_ENABLED_KEY);
  // On by default (the safety net should exist from day one); only an explicit off wins.
  return r?.[TRAIL_ENABLED_KEY] !== false;
}

export async function setTrailEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [TRAIL_ENABLED_KEY]: enabled });
}

const tracked = new Map<number, TrackedTab>();
let queue: PendingCapture[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
/** Restores state after the worker wakes; handlers that read it wait on this. */
let ready: Promise<void> = Promise.resolve();

function track(tabId: number, entry: TrackedTab): void {
  tracked.set(tabId, entry);
  void browser.storage.session.set({ [`${TAB_PREFIX}${tabId}`]: entry }).catch(() => {});
}

function persistQueue(): void {
  const write = queue.length
    ? browser.storage.session.set({ [QUEUE_KEY]: queue })
    : browser.storage.session.remove(QUEUE_KEY);
  void Promise.resolve(write).catch(() => {});
}

/** Load what survived the worker sleeping, and pick up tabs we've never seen (e.g. after install). */
async function restore(): Promise<void> {
  const [stored, all, times] = await Promise.all([
    browser.storage.session.get(null).then((r: Record<string, unknown> | undefined) => r ?? {}),
    browser.tabs.query({}),
    loadOpenedTimes().catch(() => ({ opened: {} as Record<number, number> })),
  ]);
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(TAB_PREFIX) || !value) continue;
    const id = Number(key.slice(TAB_PREFIX.length));
    if (!tracked.has(id)) tracked.set(id, value as TrackedTab);
  }
  const savedQueue = stored[QUEUE_KEY];
  if (Array.isArray(savedQueue) && savedQueue.length) {
    queue = [...(savedQueue as PendingCapture[]), ...queue];
    scheduleFlush();
  }
  for (const tab of all as Tabs.Tab[]) {
    if (tab.id == null || tracked.has(tab.id) || !isWebUrl(tab.url)) continue;
    track(tab.id, { url: tab.url, title: tab.title || tab.url, openedAt: times.opened[tab.id] });
  }
}

export function registerTrailTracker(): void {
  ready = restore().catch(() => {});

  browser.tabs.onCreated.addListener((tab: Tabs.Tab) => {
    if (tab.id == null) return;
    const url = tab.url || tab.pendingUrl || "";
    track(tab.id, { url, title: tab.title || url, openedAt: Date.now() });
  });

  browser.tabs.onUpdated.addListener(
    (tabId: number, change: Tabs.OnUpdatedChangeInfoType, tab: Tabs.Tab) => {
      if (change.url === undefined && change.title === undefined) return;
      const prev = tracked.get(tabId);
      const url = tab.url ?? change.url ?? prev?.url ?? "";
      const title = tab.title ?? change.title ?? prev?.title ?? url;
      track(tabId, { url, title, openedAt: prev?.openedAt });
    },
  );

  browser.tabs.onRemoved.addListener((tabId: number) => {
    const closedAt = Date.now();
    void onTabClosed(tabId, closedAt).catch(() => {});
  });
}

async function onTabClosed(tabId: number, closedAt: number): Promise<void> {
  await ready;
  const entry = tracked.get(tabId);
  tracked.delete(tabId);
  void browser.storage.session.remove(`${TAB_PREFIX}${tabId}`).catch(() => {});
  if (!entry || !(await isTrailEnabled())) return;

  // Your name/note for the page follow it into the trail.
  const meta = await getTabMeta(entry.url);
  const item: TrailCaptureItem = {
    url: entry.url,
    title: entry.title || entry.url,
    ...(entry.openedAt !== undefined && { openedAt: entry.openedAt }),
    closedAt,
    ...(meta.title && { customTitle: meta.title }),
    ...(meta.note && { note: meta.note }),
  };
  if (!shouldTrail(item)) return;

  // Still open in another tab → you haven't really closed the page.
  const key = normalizeUrl(item.url);
  const open = (await browser.tabs.query({})) as Tabs.Tab[];
  if (open.some((t) => t.id !== tabId && !!t.url && normalizeUrl(t.url) === key)) return;

  if (!(await isAuthenticated().catch(() => false))) return;
  enqueue(item);
}

function enqueue(item: TrailCaptureItem): void {
  // Closed twice before the flush: keep one entry, with the latest close.
  const key = normalizeUrl(item.url);
  queue = [
    ...queue.filter((p) => p.attempts > 0 || normalizeUrl(p.url) !== key),
    { ...item, attempts: 0 },
  ];
  persistQueue();
  scheduleFlush();
}

function scheduleFlush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushTrail();
  }, FLUSH_DEBOUNCE_MS);
}

/** Send up to one batch. Never throws. */
export async function flushTrail(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.slice(0, MAX_TRAIL_BATCH);
  try {
    // Send every captured field (incl. your name/note) — only the retry count is internal.
    await captureTrail(
      batch.map((queued) => {
        const item: TrailCaptureItem & { attempts?: number } = { ...queued };
        delete item.attempts;
        return item;
      }),
    );
    queue = queue.filter((p) => !batch.includes(p));
    notifySaved();
  } catch {
    for (const p of batch) p.attempts += 1;
    queue = queue.filter((p) => !batch.includes(p) || p.attempts < MAX_ATTEMPTS);
  } finally {
    flushing = false;
  }
  persistQueue();
  // More than one batch of fresh closes: send the rest now. Failed items wait.
  if (queue.some((p) => p.attempts === 0)) scheduleFlush();
}

function notifySaved(): void {
  try {
    void Promise.resolve(browser.runtime.sendMessage({ type: TRAIL_SAVED_MESSAGE })).catch(
      () => {}, // no panel open
    );
  } catch {
    // ignore
  }
}
