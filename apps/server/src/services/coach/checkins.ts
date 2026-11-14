import { hhmm, minutesOf } from "./time.js";

/** The hours the user works, in their own timezone. `days` uses 0 for Sunday. */
export interface WorkHours {
  days: number[];
  start: string;
  end: string;
}

/** Every tunable number for check-ins, in one place. */
export const CHECKIN_DEFAULTS = {
  /** The last stretch of the day, when the bot asks for a photo instead of checking in. */
  endWindowMin: 30,
  /** At least this long between any two check-ins, the photo ask included. */
  minGapMin: 120,
  /** Every check-in counts towards this, the photo ask included. */
  maxPerDay: 4,
  /** After this many in a row with no answer, stop for the day. */
  stopAfterIgnored: 2,
} as const;

export type CheckInKind = "start" | "during" | "end";

/** What has already happened today. */
export interface CheckInDay {
  kinds: CheckInKind[];
  /** Local "HH:MM" of the most recent check-in, or null. */
  lastAt: string | null;
  /** How many of the latest check-ins in a row went unanswered. */
  ignored: number;
  /** A progress photo was already sent today, so there is no need to ask for one. */
  photoToday?: boolean;
}

export function inWorkingHours(
  local: { time: string; dow: number },
  work: WorkHours | null,
): boolean {
  if (!work || !work.days.includes(local.dow)) return false;
  const t = minutesOf(local.time);
  return t >= minutesOf(work.start) && t < minutesOf(work.end);
}

/**
 * How many of the latest check-ins in a row got no answer.
 *
 * A check-in is answered by a tap, or by anything typed between it and the
 * next check-in (or now, for the last one). Counting stops at the first
 * answered one, so a reply to the morning check-in is not forgotten when a
 * later one is ignored. Times only need to sort as text (ISO, or "HH:MM").
 */
export function countIgnored(
  checkins: { createdAt: string; chosen: number | null }[],
  userTimes: string[],
  now: string,
): number {
  let ignored = 0;
  for (let i = checkins.length - 1; i >= 0; i--) {
    const from = checkins[i].createdAt;
    const until = i + 1 < checkins.length ? checkins[i + 1].createdAt : now;
    const typed = userTimes.some((t) => t > from && t <= until);
    if (checkins[i].chosen !== null || typed) break;
    ignored++;
  }
  return ignored;
}

/**
 * Whether to check in now, and how.
 *
 * - "start": the first of the day ("What are you on today?"), whenever that is.
 * - "during": a mid-day check.
 * - "end": once, in the last stretch, asking for a photo of progress.
 *
 * All three share one budget: at most a few a day, never closer than a couple
 * of hours. A mid-day check is not sent so late that it would crowd out the
 * photo ask. Ignored check-ins are the signal to stop: after a couple in a
 * row with no answer there are none for the rest of the day.
 */
export function nextCheckIn(
  local: { date: string; time: string; dow: number },
  work: WorkHours | null,
  day: CheckInDay,
): CheckInKind | null {
  if (!work || !inWorkingHours(local, work)) return null;
  if (day.ignored >= CHECKIN_DEFAULTS.stopAfterIgnored) return null;

  const start = minutesOf(work.start);
  const end = minutesOf(work.end);
  // Hours too short to hold anything but the photo ask: do not check in at all.
  if (end - start <= CHECKIN_DEFAULTS.endWindowMin) return null;

  const now = minutesOf(local.time);
  const endStarts = end - CHECKIN_DEFAULTS.endWindowMin;
  const spaced = !day.lastAt || now - minutesOf(hhmm(day.lastAt)) >= CHECKIN_DEFAULTS.minGapMin;
  const room = day.kinds.length < CHECKIN_DEFAULTS.maxPerDay;

  if (now >= endStarts) {
    // Never the first thing said that day, never twice, and not if she already sent one.
    if (day.kinds.length === 0 || day.kinds.includes("end") || day.photoToday) return null;
    return room && spaced ? "end" : null;
  }
  if (day.kinds.length === 0) return "start";
  if (!room || !spaced) return null;
  // Leave the photo ask its two hours.
  if (now > endStarts - CHECKIN_DEFAULTS.minGapMin) return null;
  return "during";
}
