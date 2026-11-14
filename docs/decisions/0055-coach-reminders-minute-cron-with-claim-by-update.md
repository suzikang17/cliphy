---
type: decision
title: "Coach reminders: a minute cron that claims rows, with delivery reported by the phone"
date: 2026-11-14
category: Server
revisit: true
---

> Spec section 5 (Reminders). Plan: [`2026-11-14-creative-coach-1a-reminders`](../superpowers/plans/2026-11-14-creative-coach-1a-reminders.md).

## Why this choice

The spec's failure condition is a dated task whose reminder never reached the user. So reminders are stored rows with an explicit life (`scheduled → sent → delivered → acked`), not timers:

- **Times are planned by a pure function** (`planReminders`) from the task's date, the user's timezone and quiet hours, and re-planned whenever a task's date, time or state changes (`syncTaskReminders`).
- **`coach-fire-reminders` runs every minute** with `concurrency: 1`. It claims due rows with one guarded update (`status = 'scheduled' and fire_at <= now` → `sent`) and sends each in its own Inngest step, so an overlap or a retry cannot send a reminder twice.
- **Delivered means the phone said so** (`POST /coach/reminders/:id/delivered`). A reminder not reported within 10 minutes is sent again; one delivered but not opened is sent again after 2 hours; after 3 re-sends it expires. Two undelivered reminders in a row mark notifications as not getting through (`GET /coach/health`).
- **Nothing fires in quiet hours.** A due time inside them is announced 15 minutes before they start; re-sends wait for them to end.
- **Sending goes through the Expo push HTTP API** (`services/push.ts`), the first code in the project that sends a notification. Tokens Expo reports as `DeviceNotRegistered` are deleted.

## Options considered

- **One Inngest run per reminder with `step.sleepUntil`:** no polling, but changing a task's date means cancelling and re-creating runs, and the state lives in Inngest where the phone cannot list it to mirror locally.
- **Expo push receipts as the delivery signal:** only says the push service accepted the message, not that the phone showed it. Rejected by the spec.
- **A date library (Luxon, date-fns-tz):** not needed; `Intl.DateTimeFormat` covers wall-clock ↔ instant with a two-pass offset.
- **An email fallback when push fails:** no email provider exists in the project; the app reports the failure instead.

## Tradeoffs

- A reminder can be up to a minute late.
- The cron runs 1,440 times a day even with nothing to do (one cheap update and one select).
- Delivery depends on the phone app calling back; until the phone screens exist (plan 4) every reminder looks undelivered and is re-sent 3 times.
- Re-sends are selected with a 500-row limit and no paging. Revisit if one deployment ever has that many unanswered reminders at once.
