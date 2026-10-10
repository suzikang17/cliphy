import type { Tabs } from "wxt/browser";

// Background-side activity tracking for "worked on together" clusters. Two
// cheap signals, both in storage.session (survives the worker sleeping, cleared
// on browser restart — when Chrome reassigns tab ids anyway):
//   - a ring buffer of recent tab switches (one small write per switch)
//   - which tab opened which (Chrome's openerTabId, captured at creation)
// Nothing here leaves the machine; only the derived clusters do (see clusters.ts).

export const SWITCH_LOG_KEY = "tabs:switchLog";
export const OPENER_PREFIX = "tabs:opener:";
export const SWITCH_LOG_CAP = 500;

export interface SwitchEntry {
  tabId: number;
  at: number;
}

export interface Activity {
  switches: SwitchEntry[];
  /** child tab id → the tab that opened it */
  openers: Record<number, number>;
}

function isEntry(v: unknown): v is SwitchEntry {
  const e = v as SwitchEntry;
  return typeof e?.tabId === "number" && typeof e?.at === "number";
}

/** Append a switch, dropping consecutive duplicates and keeping the last `cap`. */
export function appendSwitch(
  log: SwitchEntry[],
  entry: SwitchEntry,
  cap = SWITCH_LOG_CAP,
): SwitchEntry[] {
  if (log.at(-1)?.tabId === entry.tabId) return log;
  const next = [...log, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** In-memory copy of the log; hydrated from storage on first use after a worker wake. */
let log: SwitchEntry[] | null = null;
/** Writes run one at a time so rapid switches can't clobber each other. */
let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch(() => {});
  return chain;
}

async function hydrate(): Promise<SwitchEntry[]> {
  if (log) return log;
  const r = await browser.storage.session.get(SWITCH_LOG_KEY);
  const stored = r?.[SWITCH_LOG_KEY];
  log = Array.isArray(stored) ? stored.filter(isEntry) : [];
  return log;
}

export function recordSwitch(tabId: number, at = Date.now()): Promise<void> {
  return enqueue(async () => {
    const current = await hydrate();
    const next = appendSwitch(current, { tabId, at });
    if (next === current) return;
    log = next;
    await browser.storage.session.set({ [SWITCH_LOG_KEY]: next });
  });
}

export function registerActivityTracker(): void {
  browser.tabs.onActivated.addListener((info: Tabs.OnActivatedActiveInfoType) => {
    void recordSwitch(info.tabId);
  });
  browser.tabs.onCreated.addListener((tab: Tabs.Tab) => {
    if (tab.id == null || tab.openerTabId == null || tab.openerTabId === tab.id) return;
    const id = tab.id;
    const opener = tab.openerTabId;
    void enqueue(() => browser.storage.session.set({ [`${OPENER_PREFIX}${id}`]: opener }));
  });
  browser.tabs.onRemoved.addListener((tabId: number) => {
    void enqueue(() => browser.storage.session.remove(`${OPENER_PREFIX}${tabId}`));
  });
}

/** Read the switch log and opener map. Works from any extension context; never throws. */
export async function loadActivity(): Promise<Activity> {
  await chain; // in the background, let pending writes land first
  try {
    const all = ((await browser.storage.session.get(null)) ?? {}) as Record<string, unknown>;
    const stored = all[SWITCH_LOG_KEY];
    const switches = Array.isArray(stored) ? stored.filter(isEntry) : [];
    const openers: Record<number, number> = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(OPENER_PREFIX) && typeof value === "number") {
        openers[Number(key.slice(OPENER_PREFIX.length))] = value;
      }
    }
    return { switches, openers };
  } catch {
    return { switches: [], openers: {} };
  }
}
