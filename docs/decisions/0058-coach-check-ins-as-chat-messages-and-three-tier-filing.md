---
type: decision
title: "Coach 1b: check-ins as day-keyed chat messages, focus as two columns, three-tier photo filing"
date: 2026-11-14
category: Server
revisit: true
---

> Spec sections 7 and 9. Plan: [`2026-11-14-creative-coach-1b-working-hours`](../superpowers/plans/2026-11-14-creative-coach-1b-working-hours.md).

## Why this choice

Inside the hours she sets, the bot checks in, her answer becomes the focus, and a progress photo files itself.

- **A check-in is an ordinary chat message** keyed `<date>:start`, `<date>:during:<time>` or `<date>:end`. The existing "said once" upsert makes two cron runs in one window harmless, and the existing button actions carry the answer. There is no check-in table: today's check-ins are read back from the thread.
- **When to check in is a pure function** (`nextCheckIn`): the first of the day asks what she is on; mid-day ones are two hours apart and capped at four; the last half hour asks for a photo; two unanswered in a row stop it for the day. A typed reply counts as an answer. `coach-checkins` runs it every 15 minutes, only for accounts with a timezone and working hours, never in quiet hours.
- **Focus is two columns** on `coach_settings` (`focus_project_id`, `focus_set_at`), set by a check-in button, the chat agent's `set_focus` tool, or nothing else.
- **Filing is three tiers** (`fileProgress`): sure when the focus is under 6 hours old or she named the project (filed quietly; the phone shows where); fairly sure for an older focus or a single active project (filed, and said in chat with a way to move it); otherwise unsure (saved without a project and asked once). A progress photo is also a Library clip, and its project tag follows when the photo is moved.

## Options considered

- **A check-ins table with its own state machine:** more to keep in step with the thread, which already records what was said and whether it was answered.
- **Guessing a project from the image with vision:** tempting, but the spec's rule is to ask rather than guess between projects; the image is still described and tagged as a clip.
- **Location or calendar as a focus signal:** out of scope; the spec rules out location tracking for build 1.

## Tradeoffs

- "Ignored" is judged from the last check-ins of the day only; a button tapped hours later still counts as answered.
- Check-in times drift by up to 15 minutes (the cron interval).
- Sure filings say nothing in chat, so the only record of where a quietly filed photo went is the project page and the Library clip's tag.
- Corrections to a filing do not yet become learned rules.
