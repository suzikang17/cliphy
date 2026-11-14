import { DEFAULT_COACH_SETTINGS, type CoachSettings } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { planReminders } from "./reminderPlan.js";
import { hhmm } from "./time.js";

const log = logger.child({ service: "coach-reminders" });

type Row = Record<string, unknown>;

/** Reminder statuses that can still reach the user, and so must be cancelled when stale. */
const PENDING = ["scheduled", "sent", "delivered"];

/** The user's reminder settings, with defaults when they have never set any. */
export async function loadSettings(userId: string): Promise<CoachSettings> {
  const { data } = await supabase
    .from("coach_settings")
    .select("timezone, quiet_start, quiet_end, review_dow, review_time")
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as Row | null;
  if (!row) return { ...DEFAULT_COACH_SETTINGS };
  return {
    timezoneSet: Boolean(row.timezone),
    timezone: (row.timezone as string) || DEFAULT_COACH_SETTINGS.timezone,
    quietStart: hhmm((row.quiet_start as string) ?? DEFAULT_COACH_SETTINGS.quietStart),
    quietEnd: hhmm((row.quiet_end as string) ?? DEFAULT_COACH_SETTINGS.quietEnd),
    reviewDow: (row.review_dow as number) ?? DEFAULT_COACH_SETTINGS.reviewDow,
    reviewTime: hhmm((row.review_time as string) ?? DEFAULT_COACH_SETTINGS.reviewTime),
  };
}

/**
 * Bring the stored reminders for these tasks in line with the tasks.
 *
 * Call it whenever a task's date, time or state changes. An open or waiting
 * dated task gets its planned reminders; anything else has its pending ones
 * cancelled, so a finished or re-dated task never fires an old reminder.
 * A reminder whose time is unchanged is left exactly as it is, so one that
 * has already gone out is not sent again.
 *
 * Returns false (and logs) when a read or write failed. Callers carry on —
 * the task itself is saved — and the reconcile job plans what was missed.
 */
export async function syncTaskReminders(
  userId: string,
  taskIds: string[],
  now: Date = new Date(),
): Promise<boolean> {
  if (taskIds.length === 0) return true;

  const [tasksRes, remindersRes, settings] = await Promise.all([
    supabase
      .from("coach_tasks")
      .select("id, state, due_date, due_time")
      .eq("user_id", userId)
      .in("id", taskIds),
    supabase
      .from("coach_reminders")
      .select("id, task_id, kind, fire_at, status")
      .eq("user_id", userId)
      .in("task_id", taskIds),
    loadSettings(userId),
  ]);
  if (tasksRes.error || remindersRes.error) {
    log.error("Could not load tasks to plan reminders", undefined, { userId, taskIds });
    return false;
  }
  // Without a timezone "09:00" has no meaning; planning in UTC would fire in
  // the middle of someone's night. Planning happens when the timezone is set.
  if (!settings.timezoneSet) return true;

  const existing = (remindersRes.data as Row[]) ?? [];
  const upserts: Row[] = [];
  const cancelIds: string[] = [];

  for (const task of (tasksRes.data as Row[]) ?? []) {
    const active = task.state === "open" || task.state === "waiting";
    const mine = existing.filter((r) => r.task_id === task.id);
    const hasFired = mine.some(
      (r) => r.status !== "cancelled" && Date.parse(r.fire_at as string) <= now.getTime(),
    );
    const planned = active
      ? planReminders(
          {
            dueDate: (task.due_date as string) ?? null,
            dueTime: (task.due_time as string) ?? null,
          },
          settings,
          now,
          { hasFired },
        )
      : [];

    for (const p of planned) {
      const current = mine.find((r) => r.kind === p.kind);
      const unchanged =
        current &&
        current.status !== "cancelled" &&
        Date.parse(current.fire_at as string) === p.fireAt.getTime();
      if (unchanged) continue;
      upserts.push({
        user_id: userId,
        task_id: task.id,
        kind: p.kind,
        fire_at: p.fireAt.toISOString(),
        status: "scheduled",
        resends: 0,
        sent_at: null,
        delivered_at: null,
        acked_at: null,
      });
    }

    const plannedKinds = new Set(planned.map((p) => p.kind));
    for (const r of mine) {
      if (!plannedKinds.has(r.kind as never) && PENDING.includes(r.status as string)) {
        cancelIds.push(r.id as string);
      }
    }
  }

  let ok = true;
  if (upserts.length > 0) {
    const { error } = await supabase
      .from("coach_reminders")
      .upsert(upserts, { onConflict: "task_id,kind" });
    if (error) {
      log.error("Could not save reminders", undefined, { userId, taskIds });
      ok = false;
    }
  }
  for (const id of cancelIds) {
    const { error } = await supabase
      .from("coach_reminders")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) ok = false;
  }
  return ok;
}
