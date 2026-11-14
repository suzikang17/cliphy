// Wall-clock ↔ instant helpers for reminders, using Intl only (no date library).
// Dates are "YYYY-MM-DD", times "HH:MM" (a trailing ":SS" from Postgres is ignored).

const hhmm = (time: string): string => time.slice(0, 5);
const minutesOf = (time: string): number => {
  const [h, m] = hhmm(time).split(":").map(Number);
  return h * 60 + m;
};
const pad = (n: number): string => String(n).padStart(2, "0");

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

function wallClock(at: Date, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** How far ahead of UTC the zone is at this instant, in milliseconds. */
function offsetMs(at: Date, tz: string): number {
  const w = wallClock(at, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The instant at which the clock in `tz` reads `date` `time`. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const mins = minutesOf(time);
  const naive = Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
  // The offset depends on the instant, which depends on the offset: settle it
  // in two passes so times next to a daylight-saving change come out right.
  let at = naive - offsetMs(new Date(naive), tz);
  at = naive - offsetMs(new Date(at), tz);
  return new Date(at);
}

/** What the clock and calendar in `tz` read at this instant. `dow` is 0 for Sunday. */
export function localParts(at: Date, tz: string): { date: string; time: string; dow: number } {
  const w = wallClock(at, tz);
  return {
    date: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
    dow: new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay(),
  };
}

export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** Move a wall-clock time by minutes; `dayOffset` says if it crossed midnight. */
export function shiftMinutes(time: string, delta: number): { time: string; dayOffset: number } {
  const total = minutesOf(time) + delta;
  const dayOffset = Math.floor(total / 1440);
  const inDay = total - dayOffset * 1440;
  return { time: `${pad(Math.floor(inDay / 60))}:${pad(inDay % 60)}`, dayOffset };
}

/** Whether `time` falls in the quiet window, which may cross midnight. */
export function inQuietHours(time: string, quietStart: string, quietEnd: string): boolean {
  const t = minutesOf(time);
  const start = minutesOf(quietStart);
  const end = minutesOf(quietEnd);
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export { hhmm, minutesOf };
