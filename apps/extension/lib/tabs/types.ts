import type { Tabs } from "wxt/browser";

/** An open http(s) tab, normalized from `browser.tabs.Tab`. */
export interface OpenTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
  active: boolean;
  /** ms since epoch; 0 when Chrome did not report it. */
  lastAccessed: number;
  /** Unloaded by Chrome's memory saver — no page to read. */
  discarded: boolean;
}

/** Only real web pages: no chrome://, extension, file://, about: pages. */
export function isWebUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/** Hostname with a leading `www.` stripped, or "" for an unparsable URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function toOpenTab(tab: Tabs.Tab): OpenTab | null {
  if (tab.id == null || tab.windowId == null || !isWebUrl(tab.url)) return null;
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl,
    active: !!tab.active,
    lastAccessed: (tab as Tabs.Tab & { lastAccessed?: number }).lastAccessed ?? 0,
    discarded: !!tab.discarded,
  };
}
