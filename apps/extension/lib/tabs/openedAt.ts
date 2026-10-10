// Chrome reports when a tab was last viewed (`tab.lastAccessed`) but not when it
// was opened, so the background worker records open times itself. Kept in
// storage.session: it survives the worker sleeping, and is cleared on browser
// restart — which is right, since Chrome reassigns tab ids then.

export const OPENED_PREFIX = "tabs:opened:";
/** When tracking began this browser session; tabs older than it have no open time. */
export const TRACKING_SINCE_KEY = "tabs:trackingSince";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export async function recordOpened(tabId: number, at = Date.now()): Promise<void> {
  await browser.storage.session.set({ [`${OPENED_PREFIX}${tabId}`]: at });
}

export async function forgetOpened(tabId: number): Promise<void> {
  await browser.storage.session.remove(`${OPENED_PREFIX}${tabId}`);
}

export async function ensureTrackingSince(now = Date.now()): Promise<void> {
  const existing = await browser.storage.session.get(TRACKING_SINCE_KEY);
  if (typeof existing?.[TRACKING_SINCE_KEY] === "number") return;
  await browser.storage.session.set({ [TRACKING_SINCE_KEY]: now });
}

export async function loadOpenedTimes(): Promise<{
  opened: Record<number, number>;
  trackingSince: number | null;
}> {
  const all = ((await browser.storage.session.get(null)) ?? {}) as Record<string, unknown>;
  const opened: Record<number, number> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(OPENED_PREFIX) && typeof value === "number") {
      opened[Number(key.slice(OPENED_PREFIX.length))] = value;
    }
  }
  const since = all[TRACKING_SINCE_KEY];
  return { opened, trackingSince: typeof since === "number" ? since : null };
}

/** "just now", "5m ago", "2h ago", "3d ago", "6w ago". */
export function formatAgo(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at);
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < WEEK) return `${Math.floor(d / DAY)}d ago`;
  return `${Math.floor(d / WEEK)}w ago`;
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Second line of a tab row: "opened 3d ago · viewed 2h ago". */
export function tabTimesLabel({
  openedAt,
  trackingSince,
  lastAccessed,
  active,
  now = Date.now(),
}: {
  openedAt: number | undefined;
  trackingSince: number | null;
  lastAccessed: number;
  active: boolean;
  now?: number;
}): string {
  const parts: string[] = [];
  if (openedAt) parts.push(`opened ${formatAgo(openedAt, now)}`);
  else if (trackingSince) parts.push(`open since before ${clockTime(trackingSince)}`);

  if (active) parts.push("viewing now");
  else if (lastAccessed > 0) parts.push(`viewed ${formatAgo(lastAccessed, now)}`);

  return parts.join(" · ");
}

/** Exact times for the row's hover tooltip. */
export function tabTimesTitle(openedAt: number | undefined, lastAccessed: number): string {
  const lines: string[] = [];
  if (openedAt) lines.push(`Opened ${new Date(openedAt).toLocaleString()}`);
  if (lastAccessed > 0) lines.push(`Last viewed ${new Date(lastAccessed).toLocaleString()}`);
  return lines.join("\n");
}
