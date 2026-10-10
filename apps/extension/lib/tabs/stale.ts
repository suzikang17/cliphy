import { normalizeUrl } from "@cliphy/shared";
import type { OpenTab } from "./types";

/** A tab untouched for longer than this gets the "stale" marker. */
export const STALE_AFTER_MS = 3 * 86_400_000;

/** Unknown last-access (0) is never stale — we can't tell. */
export function isStale(tab: { lastAccessed?: number }, now: number): boolean {
  return !!tab.lastAccessed && now - tab.lastAccessed > STALE_AFTER_MS;
}

/** Stale tabs worth stowing, oldest first. Pinned and active tabs are never included. */
export function staleTabs(tabs: OpenTab[], pinnedKeys: Set<string>, now: number): OpenTab[] {
  return tabs
    .filter((t) => !t.active && isStale(t, now) && !pinnedKeys.has(normalizeUrl(t.url) ?? t.url))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
}
