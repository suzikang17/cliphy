---
lore_type: devlog
created: 2026-11-17
title: "Day 72 — Inngest was never told about the coach jobs; batches and texts on tasks"
date: 2026-11-17
day: 72
phase: Growth
---

**Captured messages had sat unread for two days because Inngest still had the pre-coach job list. Fixed by hand, then by a workflow. Built batches (pick finished work, check each item, AI summary for the client) and pulling texts into a hand-added task.**

## What got done

- **Inngest sync** (`248a6a2`). `.github/workflows/inngest-sync.yml` sends `PUT /api/inngest` after every production deploy.
- **Batches, server** (`a5b033c`). Migration `046_coach_batches.sql` (applied to production): `coach_batches`, `coach_batch_items`, `coach_task_messages`. Routes under `/coach/batches`: list, candidates, create, read, tick an item, write the summary, edit it, mark sent, remove. `noteOutgoing` in intake marks a batch sent when the Mac uploads its summary going out. [ADR 0063](../decisions/0063-batches-as-a-checklist-over-requests-tasks-and-messages.md).
- **Texts on a task, server.** `GET/POST/DELETE /coach/tasks/:id/messages` and `GET /coach/people/:id/messages` to pick from.
- **Phone** (`e516a7f`). Project page: "Add a task" and "Batches". New screens: pick (`coach/batch/new`), check and summary (`coach/batch/[id]`), message picker (`coach/task-messages`). Task page shows the texts pulled into it. Ships by OTA.

## Issues

- **Messages captured, nothing in Chat.** Three messages were stored on Nov 15–16 and their bundle stayed `collecting` with 0 attempts; even the 10-minute sweep had not touched it. Root cause: Inngest only runs the functions it was last told about, and nothing had told it since before the coach jobs were added. `curl -X PUT https://api.cliphy.app/api/inngest` answered `"modified": true`; the sweep read the bundle four minutes later and the request appeared in Chat.
- **A tapped answer said nothing back.** The owner tapped an answer on that request. The request was confirmed and two tasks were made, but no "Saved. 2 tasks added." row exists in `coach_chat_messages`. The tap landed 50 seconds after a deploy. Not diagnosed: server logs are not readable from the devbox (Vercel CLI logged out). In the backlog.
- The earlier devlog line "a text reaching Chat ... reported good" does not match production, which had no chat rows before today.

## What to remember

- `GET /api/inngest` answers 401 to an unsigned caller on SDK v4, so it cannot be used to see what is registered. `PUT` needs no signature and re-registers.
- After adding or renaming any Inngest function, check the sync workflow ran. A job that is not registered fails silently: events are accepted and nothing runs.
- A batch item that is a message picked on its own uses the message text as its label, so the check screen shows only its pictures underneath.
- TDD lapse: hand-added tasks in batches (candidates, create, their messages) were written before their tests; the tests were added after and passed first time.
- Not seen on a device yet: every new phone screen. Not run against the real model: the summary.
