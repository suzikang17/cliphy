import type { PinnedItem, Summary } from "@cliphy/shared";
import { get, set } from "./storage";

const KEY = "newtab:snapshot";

export interface NewTabSnapshot {
  pins: PinnedItem[];
  /** Panel id → the clips it last resolved to. "inbox" is the default panel. */
  panels: Record<string, Summary[]>;
  savedAt: number;
}

/**
 * The new tab must paint before the user perceives it, so the page renders
 * from this snapshot first and revalidates behind it. A corrupt or missing
 * value is not an error — it just means a cold start.
 */
export async function readSnapshot(): Promise<NewTabSnapshot | null> {
  try {
    const raw = await get<unknown>(KEY);
    if (!raw || typeof raw !== "object") return null;
    const snap = raw as Partial<NewTabSnapshot>;
    if (!Array.isArray(snap.pins) || typeof snap.panels !== "object" || !snap.panels) return null;
    return { pins: snap.pins, panels: snap.panels, savedAt: snap.savedAt ?? 0 };
  } catch {
    // Storage can throw in odd contexts; a cold start beats a broken new tab.
    return null;
  }
}

export async function writeSnapshot(snapshot: NewTabSnapshot): Promise<void> {
  try {
    await set(KEY, snapshot);
  } catch {
    // A cache write failing must never break the page.
  }
}
