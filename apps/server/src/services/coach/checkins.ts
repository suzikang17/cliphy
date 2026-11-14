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
  /** No mid-day check-in this close to the end window: it would run straight into it. */
  quietBeforeEndMin: 45,
  /** At least this long between check-ins. */
  minGapMin: 120,
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
 * Whether to check in now, and how.
 *
 * - "start": the first of the day ("What are you on today?"), whenever that is.
 * - "during": a mid-day check, spaced out and capped.
 * - "end": once, in the last stretch, asking for a photo of progress.
 *
 * Ignored check-ins are the signal to stop: after a couple in a row with no
 * answer there are none for the rest of the day.
 */
export function nextCheckIn(
  local: { date: string; time: string; dow: number },
  work: WorkHours | null,
  day: CheckInDay,
): CheckInKind | null {
  if (!work || !inWorkingHours(local, work)) return null;
  if (day.ignored >= CHECKIN_DEFAULTS.stopAfterIgnored) return null;

  const now = minutesOf(local.time);
  const endStarts = minutesOf(work.end) - CHECKIN_DEFAULTS.endWindowMin;

  if (now >= endStarts) return day.kinds.includes("end") ? null : "end";
  if (day.kinds.length === 0) return "start";
  if (day.kinds.length >= CHECKIN_DEFAULTS.maxPerDay) return null;
  if (now >= endStarts - CHECKIN_DEFAULTS.quietBeforeEndMin) return null;
  if (day.lastAt && now - minutesOf(hhmm(day.lastAt)) < CHECKIN_DEFAULTS.minGapMin) return null;
  return "during";
}
