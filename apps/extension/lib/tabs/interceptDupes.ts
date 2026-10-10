import type { Tabs } from "wxt/browser";
import { decideIntercept, normalizeUrl } from "./dedupe";
import { showDupeToast } from "./dupeToast";
import { isWebUrl, toOpenTab, type OpenTab } from "./types";

// Background-side duplicate interception. A *newly created* tab that lands on a
// page already open elsewhere is closed; foreground ones switch you to the
// existing copy. Only a tab's first web URL is checked — navigating an existing
// tab is never intercepted. All local: no network, so it's instant.

export const DEDUPE_ENABLED_KEY = "tabs:dedupe:enabled"; // storage.local, default on
const NEW_PREFIX = "tabs:dedupe:new:"; // storage.session, tabId → createdAt
const BYPASS_KEY = "tabs:dedupe:bypass"; // storage.session, [{ url, until }]
export const LAST_INTERCEPT_KEY = "tabs:dedupe:last"; // storage.session, for the panel's Undo

const NEW_TAB_TTL_MS = 5 * 60_000;
const BYPASS_TTL_MS = 30_000;

export interface LastIntercept {
  url: string;
  title: string;
  at: number;
}

export async function isDedupeEnabled(): Promise<boolean> {
  const r = await browser.storage.local.get(DEDUPE_ENABLED_KEY);
  return r?.[DEDUPE_ENABLED_KEY] !== false;
}

export async function setDedupeEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [DEDUPE_ENABLED_KEY]: enabled });
}

async function activeBypass(now: number): Promise<{ url: string; until: number }[]> {
  const r = await browser.storage.session.get(BYPASS_KEY);
  const list = (r?.[BYPASS_KEY] as { url: string; until: number }[] | undefined) ?? [];
  return list.filter((b) => b.until > now);
}

/** Undo: reopen the closed duplicate, and let it through for a moment. */
export async function undoIntercept(url: string): Promise<void> {
  const now = Date.now();
  const key = normalizeUrl(url);
  if (key) {
    const list = await activeBypass(now);
    await browser.storage.session.set({
      [BYPASS_KEY]: [...list, { url: key, until: now + BYPASS_TTL_MS }],
    });
  }
  await browser.storage.session.remove(LAST_INTERCEPT_KEY);
  await browser.tabs.create({ url });
}

/** In-memory guard against redirect bursts firing onUpdated twice for one tab. */
const checking = new Set<number>();
/**
 * New-tab flags kept in memory too: onCreated's storage write is async, and for a
 * tab opened straight to a URL, onUpdated can fire before it lands. Session
 * storage is the fallback for when the worker slept between the two events.
 */
const newTabs = new Map<number, number>();

export function registerDupeInterceptor(): void {
  browser.tabs.onCreated.addListener((tab: Tabs.Tab) => {
    if (tab.id != null) {
      newTabs.set(tab.id, Date.now());
      void browser.storage.session.set({ [`${NEW_PREFIX}${tab.id}`]: Date.now() }).catch(() => {});
    }
  });
  browser.tabs.onRemoved.addListener((tabId: number) => {
    newTabs.delete(tabId);
    void browser.storage.session.remove(`${NEW_PREFIX}${tabId}`).catch(() => {});
  });
  browser.tabs.onUpdated.addListener(
    (tabId: number, change: Tabs.OnUpdatedChangeInfoType, tab: Tabs.Tab) => {
      if (!change.url || !isWebUrl(change.url) || checking.has(tabId)) return;
      checking.add(tabId);
      void checkNewTab(tabId, tab)
        .catch(() => {})
        .finally(() => checking.delete(tabId));
    },
  );
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as { type?: string; url?: string };
    if (m?.type === "DEDUPE_UNDO" && typeof m.url === "string") void undoIntercept(m.url);
  });
}

async function checkNewTab(tabId: number, tab: Tabs.Tab): Promise<void> {
  const flagKey = `${NEW_PREFIX}${tabId}`;
  let createdAt = newTabs.get(tabId);
  if (createdAt === undefined) {
    const flag = await browser.storage.session.get(flagKey);
    createdAt = flag?.[flagKey] as number | undefined;
  }
  if (!createdAt) return; // not a new tab — a navigation of an existing one
  // Only the first web URL counts.
  newTabs.delete(tabId);
  await browser.storage.session.remove(flagKey);
  const now = Date.now();
  if (now - createdAt > NEW_TAB_TTL_MS) return;

  const newTab = toOpenTab(tab);
  if (!newTab) return;
  const [enabled, bypass, all] = await Promise.all([
    isDedupeEnabled(),
    activeBypass(now),
    browser.tabs.query({}),
  ]);
  const allTabs = all
    .map((t: Tabs.Tab) => toOpenTab(t))
    .filter((t: OpenTab | null): t is OpenTab => t !== null);

  const decision = decideIntercept({
    newTab,
    allTabs,
    enabled,
    bypass: bypass.map((b: { url: string }) => b.url),
  });
  if (decision.action === "none") return;

  const { existing } = decision;
  if (decision.action === "switch") {
    await browser.tabs.update(existing.id, { active: true });
    await browser.windows.update(existing.windowId, { focused: true });
  }
  await browser.tabs.remove(tabId);

  const last: LastIntercept = { url: newTab.url, title: newTab.title, at: now };
  await browser.storage.session.set({ [LAST_INTERCEPT_KEY]: last });

  if (decision.action === "switch") {
    // Best-effort on-page toast with Undo; needs the optional page permission.
    await browser.scripting
      ?.executeScript({ target: { tabId: existing.id }, func: showDupeToast, args: [newTab.url] })
      .catch(() => {});
  }
}
