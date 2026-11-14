import type { CoachSettings, ReminderKind, ReminderStatus } from "@cliphy/shared";
import {
  addDays,
  hhmm,
  inQuietHours,
  localParts,
  minutesOf,
  shiftMinutes,
  zonedToUtc,
} from "./time.js";

/** Every tunable number for reminders, in one place. */
export const REMINDER_DEFAULTS = {
  /** Local time for the day-before and morning-of reminders. */
  dayTime: "09:00",
  /** A reminder that would land in quiet hours arrives this long before they start. */
  quietLeadMinutes: 15,
  /** Reminders closer together than this collapse into the earlier one. */
  collapseMs: 30 * 60_000,
  /** Re-send when the phone has not reported receiving it. */
  undeliveredResendMs: 10 * 60_000,
  /** Re-send when it was received but not opened or answered. */
  unackedResendMs: 2 * 60 * 60_000,
  maxResends: 3,
} as const;

export interface PlannedReminder {
  kind: ReminderKind;
  fireAt: Date;
}

/**
 * When a dated task should remind, as instants.
 *
 * Nothing lands in quiet hours: a due time inside them is announced shortly
 * before they start (so it is early, never missed), and the morning reminders
 * wait for them to end.
 */
export function planReminders(
  task: { dueDate: string | null; dueTime: string | null },
  settings: CoachSettings,
  now: Date,
): PlannedReminder[] {
  const { dueDate } = task;
  if (!dueDate) return [];
  const { timezone: tz, quietStart, quietEnd } = settings;
  const quiet = (time: string) => inQuietHours(time, quietStart, quietEnd);

  const morning = quiet(REMINDER_DEFAULTS.dayTime) ? hhmm(quietEnd) : REMINDER_DEFAULTS.dayTime;
  const wall: { kind: ReminderKind; date: string; time: string }[] = [
    { kind: "day_before", date: addDays(dueDate, -1), time: morning },
    { kind: "morning_of", date: dueDate, time: morning },
  ];

  if (task.dueTime) {
    let date = dueDate;
    let time = hhmm(task.dueTime);
    if (quiet(time)) {
      const before = shiftMinutes(quietStart, -REMINDER_DEFAULTS.quietLeadMinutes);
      // Late evening: earlier the same evening. Early morning: the evening before.
      const sameEvening = minutesOf(time) >= minutesOf(quietStart);
      const crossesMidnight = minutesOf(quietStart) > minutesOf(quietEnd);
      date = addDays(date, (crossesMidnight && !sameEvening ? -1 : 0) + before.dayOffset);
      time = before.time;
    }
    wall.push({ kind: "at_time", date, time });
  }

  const all = wall
    .map((w) => ({ kind: w.kind, fireAt: zonedToUtc(w.date, w.time, tz) }))
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());

  const spaced: PlannedReminder[] = [];
  for (const r of all) {
    const last = spaced.at(-1);
    if (last && r.fireAt.getTime() - last.fireAt.getTime() < REMINDER_DEFAULTS.collapseMs) continue;
    spaced.push(r);
  }

  const upcoming = spaced.filter((r) => r.fireAt.getTime() > now.getTime());
  if (upcoming.length > 0) return upcoming;

  // Everything has passed. A task still due today (or later) must not go
  // unannounced: remind as soon as it is allowed.
  const local = localParts(now, tz);
  const last = spaced.at(-1);
  if (!last || dueDate < local.date) return [];
  if (!quiet(local.time)) return [{ kind: last.kind, fireAt: now }];

  // In quiet hours: wait until they end, unless the date will have gone by then.
  const endsToday = minutesOf(local.time) < minutesOf(quietEnd);
  const endDate = endsToday ? local.date : addDays(local.date, 1);
  if (endDate > dueDate) return [];
  return [{ kind: last.kind, fireAt: zonedToUtc(endDate, quietEnd, tz) }];
}

/** What to do with a reminder that has been sent: send it again, give up, or nothing. */
export function nextResend(
  r: { status: ReminderStatus; sentAt: string | null; deliveredAt: string | null; resends: number },
  now: Date,
): "resend" | "expire" | null {
  if ((r.status !== "sent" && r.status !== "delivered") || !r.sentAt) return null;
  const wait =
    r.status === "sent" ? REMINDER_DEFAULTS.undeliveredResendMs : REMINDER_DEFAULTS.unackedResendMs;
  if (now.getTime() - Date.parse(r.sentAt) < wait) return null;
  return r.resends >= REMINDER_DEFAULTS.maxResends ? "expire" : "resend";
}
