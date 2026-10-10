import { hostOf, isWebUrl } from "./types";

export interface SiteGroup<T> {
  host: string;
  tabs: T[];
}

/**
 * Group http(s) tabs by host (`www.` stripped). Groups and rows keep input
 * order; the caller sorts. Non-web URLs are dropped.
 */
export function siteGroups<T extends { url: string }>(tabs: T[]): SiteGroup<T>[] {
  const byHost = new Map<string, T[]>();
  for (const tab of tabs) {
    if (!isWebUrl(tab.url)) continue;
    const host = hostOf(tab.url);
    if (!host) continue;
    const list = byHost.get(host);
    if (list) list.push(tab);
    else byHost.set(host, [tab]);
  }
  return [...byHost].map(([host, list]) => ({ host, tabs: list }));
}
