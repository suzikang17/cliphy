---
date: 2026-11-14
title: Creative coach 1a, plan 2 — reminders and push
---

# Creative Coach 1a, Plan 2 — Reminders and Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dated task gets reminders that are scheduled on the server, sent as push notifications, confirmed delivered by the phone, re-sent when not, and never fire at night.

**Architecture:** Reminder times are computed by a pure planner from the task's date, the user's timezone and quiet hours, and stored as rows. A once-a-minute Inngest cron sends what is due through the Expo push API and re-sends what was not delivered or acknowledged. The phone reports delivery and acknowledgement over HTTP and can list upcoming reminders to mirror as local notifications. A second cron sends the weekly back-burner review.

**Tech Stack:** Hono, Supabase, Inngest v4, Expo push HTTP API (`https://exp.host/--/api/v2/push/send`), `Intl.DateTimeFormat` for timezones (no date library), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md` (section 5, Reminders). Builds on plan 1 (`2026-11-14-creative-coach-1a-server-core.md`); its Global Constraints apply here unchanged.

## Global Constraints

- Everything in plan 1's Global Constraints.
- Nothing notifies during quiet hours (default 21:00–08:00 in the user's timezone). A reminder that would fall in them moves to 15 minutes before they start.
- "Delivered" means the phone reported receiving it, not that the push service accepted it.
- Every reminder for a dated task is a deadline reminder; undated tasks get none.
- Reminder text keeps who asked, what for and by when, and nothing else. No exclamation marks, no filler.
- Defaults (all in one constants block, easy to change): day-before and morning-of at 09:00 local; re-send after 10 minutes undelivered or 2 hours unacknowledged; at most 3 re-sends; weekly review Sunday 18:00 local.
- The server has never sent a push before: the sending path is new and is the only code that talks to Expo.

## Review Focus

1. **A task's date changes or the task is finished:** its old reminders must not fire.
2. **Daylight-saving change between planning and firing:** 09:00 local must still be 09:00 local.
3. **The phone's push token is dead** (`DeviceNotRegistered`): the token is removed, the reminder stays undelivered, and health reports it.
4. **The cron overlaps or retries:** a reminder is sent once per attempt, not twice.
5. **A due time inside quiet hours** (07:00): the reminder arrives the evening before, never at 07:00 and never dropped.

## Tasks

### Task 1: Schema, types, timezone helpers

**Files:** `apps/server/supabase/migrations/039_coach_reminders.sql`, `packages/shared/src/coach.ts`, `apps/server/src/services/coach/time.ts` (+ test).

- `coach_settings` (`user_id` pk, `timezone text not null default 'UTC'`, `quiet_start time not null default '21:00'`, `quiet_end time not null default '08:00'`, `review_dow int not null default 0`, `review_time time not null default '18:00'`, `last_review_at timestamptz`, `push_failures int not null default 0`, `last_delivered_at timestamptz`).
- `coach_reminders` (`id`, `user_id`, `task_id` → tasks `on delete cascade`, `kind text check in ('day_before','morning_of','at_time')`, `fire_at timestamptz not null`, `status text not null default 'scheduled' check in ('scheduled','sent','delivered','acked','cancelled','expired')`, `sent_at`, `delivered_at`, `acked_at`, `resends int not null default 0`, `created_at`; `unique (task_id, kind)`; index `(status, fire_at)`).
- Shared: `ReminderKind`, `ReminderStatus`, `CoachReminder { id, taskId, kind, fireAt, status, title, body }`, `CoachSettings { timezone, quietStart, quietEnd, reviewDow, reviewTime }`.
- `time.ts`: `zonedToUtc(date: string, time: string, tz: string): Date`; `localParts(at: Date, tz: string): { date: string; time: string; dow: number }`; `addDays(date: string, n: number): string`; `inQuietHours(time: string, quietStart: string, quietEnd: string): boolean` (handles a window that crosses midnight); `isValidTimezone(tz: string): boolean`.

Tests pin: `zonedToUtc("2026-11-18","09:00","America/Los_Angeles")` → `2026-11-18T17:00:00Z`; the same wall time on `2026-03-09` (after the US spring change) → `16:00Z`; `localParts` round-trips both; `inQuietHours("07:00","21:00","08:00")` true, `"08:00"` false, `"21:00"` true, `"20:59"` false; a same-day window `("13:00","12:00","14:00")` true; an unknown timezone is invalid.

### Task 2: Reminder planner and text (pure)

**Files:** `apps/server/src/services/coach/reminderPlan.ts`, `reminderText.ts` (+ tests).

```ts
export const REMINDER_DEFAULTS = {
  dayTime: "09:00",
  quietLeadMinutes: 15,
  undeliveredResendMs: 600_000,
  unackedResendMs: 7_200_000,
  maxResends: 3,
} as const;
export interface PlannedReminder {
  kind: ReminderKind;
  fireAt: Date;
}
export function planReminders(
  task: { dueDate: string | null; dueTime: string | null },
  settings: CoachSettings,
  now: Date,
): PlannedReminder[];
/** When a sent reminder should be sent again, or null. */
export function nextResend(
  r: { status: ReminderStatus; sentAt: string | null; deliveredAt: string | null; resends: number },
  now: Date,
): "resend" | "expire" | null;
export function reminderText(input: {
  kind: ReminderKind;
  title: string;
  taskKind: TaskKind;
  personName: string | null;
  fromRequest: boolean;
  dueTime: string | null;
}): { title: string; body: string };
```

Planner rules: no date → `[]`. `day_before` at `dayTime` the day before; `morning_of` at `dayTime` on the day; `at_time` at the due time when one is set. A time inside quiet hours moves to `quietLeadMinutes` before `quietStart` on the evening it would otherwise interrupt (07:00 → 20:45 the previous day; 22:30 → 20:45 the same day). Two reminders landing within 30 minutes of each other collapse to the earlier. Past reminders are dropped, except that when nothing is left and the due date is today or later, the latest one fires now.

`nextResend`: `sent` and undelivered for `undeliveredResendMs` → `resend`; `delivered` and unacknowledged for `unackedResendMs` since `sentAt` → `resend`; either with `resends >= maxResends` → `expire`; otherwise null.

Text: title is the task title. Body by kind — `day_before`: "Due tomorrow."; `morning_of`: "Due today."; `at_time`: "Due at 14:00." With a person and a request behind it: "Maren asked for this by tomorrow." / "…by today." / "…by 14:00."

### Task 3: Sync reminders with tasks

**Files:** `apps/server/src/services/coach/reminders.ts` (+ test); modify `routes/coach/tasks.ts` (after create, patch, sent) and `routes/coach/requests.ts` (after confirm, and after dropping a replaced request's tasks).

`export async function syncTaskReminders(userId: string, taskIds: string[], now?: Date): Promise<void>` — loads the tasks and the user's settings (defaults when no row); for each task that is `open` or `waiting` and dated, upserts the planned reminders on `(task_id, kind)` resetting `status: "scheduled"`, `fire_at`, `resends: 0`, and cancels any kind no longer planned; for any other task, cancels all of its `scheduled` and `sent` reminders. `export async function loadSettings(userId: string): Promise<CoachSettings>`.

Tests pin Review Focus 1 (date moved → old kinds re-timed, none left at the old time; task done → all cancelled) and that an undated task writes nothing.

### Task 4: Push sending

**Files:** `apps/server/src/services/push.ts` (+ test).

`export async function sendPush(userId: string, message: { title: string; body: string; data: Record<string, unknown> }): Promise<{ sent: number; dead: number }>` — loads the user's `push_tokens`, posts one batch to the Expo endpoint, deletes tokens whose ticket is `DeviceNotRegistered`, returns counts. No tokens → `{ sent: 0, dead: 0 }` without a network call. A non-2xx response throws.

Tests mock `fetch`: one good and one dead token → `{ sent: 1, dead: 1 }` and the dead token deleted (Review Focus 3); a 500 throws; the request body carries `to`, `title`, `body`, `data`, `sound: "default"`.

### Task 5: The firing job

**Files:** `apps/server/src/functions/coachReminders.ts` (+ test); register in `app.ts`.

`fireReminders` — Inngest cron `* * * * *`, `concurrency: 1` so runs never overlap. Step 1: claim due reminders with one conditional update (`status: "scheduled"` → `"sent"`, `sent_at: now`, where `fire_at <= now`, limit 200, returning rows) so a retry or overlap cannot send twice (Review Focus 4). Step 2: for each, skip-and-cancel when its task is no longer `open`/`waiting`; otherwise build the text and `sendPush` with `data: { type: "reminder", reminderId, taskId }`. Step 3: for `sent`/`delivered` reminders, apply `nextResend`: `resend` → send again (deferred while the user is in quiet hours), increment `resends`, set `sent_at`; `expire` → `status: "expired"`. Every undelivered resend increments `coach_settings.push_failures`.

`weeklyReview` — Inngest cron `0 * * * *`: for each coach-enabled user whose local day and hour match `review_dow`/`review_time` and whose `last_review_at` is more than 6 days ago, count undated open tasks; if any, push "N things on the back burner." with `data: { type: "weekly_review" }` and set `last_review_at`.

### Task 6: Reminder and settings endpoints

**Files:** `apps/server/src/routes/coach/reminders.ts`, `settings.ts` (+ tests); mount in `index.ts`.

- `GET /coach/reminders` → `{ reminders: CoachReminder[] }`: `scheduled` reminders in the next 14 days with their text, for the phone to mirror as local notifications.
- `POST /coach/reminders/:id/delivered` → sets `delivered_at`, `status: "delivered"` (only from `sent`), resets `push_failures` to 0 and stamps `last_delivered_at`.
- `POST /coach/reminders/:id/ack` → `status: "acked"`, `acked_at` (from `sent` or `delivered`).
- `GET /coach/settings`, `PATCH /coach/settings` `{ timezone?, quietStart?, quietEnd?, reviewDow?, reviewTime? }` — validates the timezone and `HH:MM` times; a timezone or quiet-hours change re-syncs reminders for all open dated tasks.
- `GET /coach/health` → `{ pushTokens: number, pushOk: boolean, lastDeliveredAt: string | null }`; `pushOk` is false with no tokens or with `push_failures >= 2`.

### Task 7: Use the user's timezone for "today"

Modify `functions/processBundle.ts`: `InterpretContext.today` comes from `localParts(new Date(), settings.timezone).date`. Test: with timezone `America/Los_Angeles` at `2026-11-15T03:00:00Z`, `today` is `2026-11-14`.

### Task 8: Docs

ADR for the firing design (minute cron and claim-by-update against per-reminder sleeps); architecture section; devlog.
