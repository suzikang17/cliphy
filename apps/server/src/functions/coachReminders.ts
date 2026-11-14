import {
  DEFAULT_COACH_SETTINGS,
  type CoachSettings,
  type ReminderKind,
  type TaskKind,
} from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { sendPush, type PushMessage } from "../services/push.js";
import { nextResend } from "../services/coach/reminderPlan.js";
import { reminderText } from "../services/coach/reminderText.js";
import { hhmm, inQuietHours, localParts } from "../services/coach/time.js";

const log = logger.child({ fn: "coach-reminders" });

type Row = Record<string, unknown>;

interface SettingsState {
  settings: CoachSettings;
  pushFailures: number;
  lastReviewAt: string | null;
}

async function settingsState(userId: string): Promise<SettingsState> {
  const { data } = await supabase
    .from("coach_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const row = (data as Row | null) ?? {};
  const d = DEFAULT_COACH_SETTINGS;
  return {
    settings: {
      timezone: (row.timezone as string) || d.timezone,
      quietStart: hhmm((row.quiet_start as string) ?? d.quietStart),
      quietEnd: hhmm((row.quiet_end as string) ?? d.quietEnd),
      reviewDow: (row.review_dow as number) ?? d.reviewDow,
      reviewTime: hhmm((row.review_time as string) ?? d.reviewTime),
    },
    pushFailures: (row.push_failures as number) ?? 0,
    lastReviewAt: (row.last_review_at as string) ?? null,
  };
}

/** The notification for a reminder, or null when its task is gone or no longer live. */
async function messageFor(r: Row): Promise<PushMessage | null> {
  const { data } = await supabase
    .from("coach_tasks")
    .select("id, title, kind, state, due_time, with_person_id, request_id")
    .eq("id", r.task_id as string)
    .eq("user_id", r.user_id as string)
    .maybeSingle();
  const task = data as Row | null;
  if (!task || (task.state !== "open" && task.state !== "waiting")) return null;

  let personName: string | null = null;
  if (task.with_person_id) {
    const { data: person } = await supabase
      .from("coach_people")
      .select("name")
      .eq("id", task.with_person_id as string)
      .eq("user_id", r.user_id as string)
      .maybeSingle();
    personName = (person as { name?: string } | null)?.name ?? null;
  }

  const text = reminderText({
    kind: r.kind as ReminderKind,
    title: task.title as string,
    taskKind: task.kind as TaskKind,
    personName,
    fromRequest: Boolean(task.request_id),
    dueTime: (task.due_time as string) ?? null,
  });
  return { ...text, data: { type: "reminder", reminderId: r.id, taskId: task.id } };
}

async function setReminder(id: string, values: Row): Promise<void> {
  await supabase.from("coach_reminders").update(values).eq("id", id);
}

/** Runs every minute and never overlaps itself. */
export const FIRE_JOB = {
  id: "coach-fire-reminders",
  concurrency: 1,
  retries: 2,
  triggers: [{ cron: "* * * * *" }],
} as const;

type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

/**
 * Send reminders that are due, and re-send ones that were not received or not
 * answered.
 *
 * Due reminders are claimed with one guarded update (scheduled → sent), so a
 * second run can never pick up the same reminder, and each send is its own
 * step, so a retry of this run does not repeat sends that already happened.
 */
export const fireReminders = inngest.createFunction(
  FIRE_JOB as never,
  (async ({ step }: { step: Step }) => {
    const claimed = await step.run("claim", async () => {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from("coach_reminders")
        .update({ status: "sent", sent_at: now })
        .eq("status", "scheduled")
        .lte("fire_at", now)
        .select("id, user_id, task_id, kind");
      return (data as Row[]) ?? [];
    });

    let sent = 0;
    for (const r of claimed) {
      sent += await step.run(`send-${r.id}`, async () => {
        const message = await messageFor(r);
        if (!message) {
          await setReminder(r.id as string, { status: "cancelled" });
          return 0;
        }
        await sendPush(r.user_id as string, message);
        return 1;
      });
    }

    const { resent, expired } = await step.run("resend", async () => {
      const now = new Date();
      const { data } = await supabase
        .from("coach_reminders")
        .select("id, user_id, task_id, kind, status, sent_at, delivered_at, resends")
        .in("status", ["sent", "delivered"])
        .limit(500);

      let resent = 0;
      let expired = 0;
      const states = new Map<string, SettingsState>();

      for (const r of (data as Row[]) ?? []) {
        const action = nextResend(
          {
            status: r.status as "sent" | "delivered",
            sentAt: (r.sent_at as string) ?? null,
            deliveredAt: (r.delivered_at as string) ?? null,
            resends: (r.resends as number) ?? 0,
          },
          now,
        );
        if (!action) continue;
        if (action === "expire") {
          await setReminder(r.id as string, { status: "expired" });
          expired++;
          continue;
        }

        const userId = r.user_id as string;
        let state = states.get(userId);
        if (!state) {
          state = await settingsState(userId);
          states.set(userId, state);
        }
        const { settings } = state;
        // Nothing notifies at night; the next run after quiet hours picks it up.
        if (
          inQuietHours(
            localParts(now, settings.timezone).time,
            settings.quietStart,
            settings.quietEnd,
          )
        ) {
          continue;
        }

        const message = await messageFor(r);
        if (!message) {
          await setReminder(r.id as string, { status: "cancelled" });
          continue;
        }
        try {
          await sendPush(userId, message);
        } catch (err) {
          log.warn("Re-send failed", { reminderId: r.id, err: String(err) });
          continue;
        }
        await setReminder(r.id as string, {
          status: "sent",
          sent_at: now.toISOString(),
          delivered_at: null,
          resends: ((r.resends as number) ?? 0) + 1,
        });
        // Never reported as received: notifications may not be getting through.
        if (r.status === "sent") {
          state.pushFailures += 1;
          await supabase
            .from("coach_settings")
            .upsert(
              { user_id: userId, push_failures: state.pushFailures },
              { onConflict: "user_id" },
            );
        }
        resent++;
      }
      return { resent, expired };
    });

    return { sent, resent, expired };
  }) as never,
);

/**
 * Undated tasks get no reminders of their own; once a week, at the user's
 * chosen day and hour, they hear how many are waiting.
 */
export const weeklyReview = inngest.createFunction(
  { id: "coach-weekly-review", retries: 1, triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    const sent = await step.run("review", async () => {
      const now = new Date();
      const { data: users } = await supabase.from("users").select("id").eq("coach_enabled", true);

      let count = 0;
      for (const user of (users as { id: string }[]) ?? []) {
        const { settings, lastReviewAt } = await settingsState(user.id);
        const local = localParts(now, settings.timezone);
        if (local.dow !== settings.reviewDow) continue;
        if (local.time.slice(0, 2) !== settings.reviewTime.slice(0, 2)) continue;
        if (lastReviewAt && now.getTime() - Date.parse(lastReviewAt) < 6 * 86_400_000) continue;
        if (inQuietHours(local.time, settings.quietStart, settings.quietEnd)) continue;

        const { data: undated } = await supabase
          .from("coach_tasks")
          .select("id")
          .eq("user_id", user.id)
          .eq("state", "open")
          .is("due_date", null);
        const n = ((undated as unknown[]) ?? []).length;
        if (n === 0) continue;

        await sendPush(user.id, {
          title: "Back burner",
          body: `${n} ${n === 1 ? "thing" : "things"} on the back burner.`,
          data: { type: "weekly_review" },
        });
        await supabase
          .from("coach_settings")
          .upsert(
            { user_id: user.id, last_review_at: now.toISOString() },
            { onConflict: "user_id" },
          );
        count++;
      }
      return count;
    });
    return { sent };
  },
);
