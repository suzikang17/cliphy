---
day: 69
date: 2026-11-14
phase: Growth
title: "Day 69 — Creative coach: design, then all of build 1 (server, reminders, chat, phone, Mac helper, 1b)"
---

**Cliphy starts growing into a coach for creatives. Designed build 1 with mockups, then built its server core: captured messages become confirmed requests with history and a chain of do/tell/ask/get tasks. Unit-tested only; nothing has run against a database or the model yet.**

> **Later the same day:** the rest of build 1 was built too. See "After the server core" at the end. The summary above describes the first part only.

## What got done

- **Design** for build 1 (capture, requests with history, four task kinds, reliable reminders, one Chat thread, Up next, learned rules, setup), with three mockups — [spec](../superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md) (`17bc3dd`, `3d51056`, `e54dbcf`). Example client and copy are fictional because the repo is public.
- **Plan 1 of 6** for 1a, the server core — [plan](../superpowers/plans/2026-11-14-creative-coach-1a-server-core.md) (`4ca7a1b`).
- **Schema + switch:** migration `038_coach_core.sql` (7 tables, `users.coach_enabled`), shared types, `requireCoach` (`0aaddb1`).
- **People and projects** (`/coach/people`, `/coach/projects`, seeding from `project:` tags) (`79e9ff3`).
- **Intake:** `/coach/intake/upload-url` and `/messages`, bundling by 3 minutes of quiet, idempotent on re-upload (`7db9be2`, `0c8298c`).
- **Interpretation:** one Claude call per bundle, validated by a pure parser (`52bbcc5`).
- **Bundle job:** Inngest `coach-process-bundle` stores a request, a linked reply, or nothing; image-clip creation extracted to `services/imageClip.ts` (`d1e4050`).
- **Requests:** list, detail, confirm (creates the chain once), fix, project history (`aefef89`).
- **Tasks:** list with computed `blocked`, create, update, sent (`c41b0c3`).
- **End-to-end script + ADR 0054 + architecture section** (`4d61b08`).
- **Review fix pass** (`3a68e94`): see Issues.

Tests: `pnpm vitest run apps/server` → 597 passed; the 3 failing tests / 5 failing files are the same ones that fail before this work (smoke tests need env, `sharp` on linux-arm64, `admin/users` set-count ×2, `embedding`).

## Decisions

- Bundles debounced in Inngest; interpretation as a tool call validated by hand; task chain stored as proposed JSON until confirm; projects tied to `project:` tags — [ADR 0054](../decisions/0054-coach-server-core-bundles-requests-and-task-chains.md).
- Chat and Library are the only two tabs; Podcasts becomes a filter, Subscriptions a "Following" row (spec).
- A person is a client, a collaborator or both (label only for now). History window is chosen per person.

## Issues

- **Forced tool calls are rejected by current models.** The plan specified `tool_choice: { type: "tool" }`; Opus 5.5 and Sonnet 5.5 return a 400. Switched to `tool_choice: auto` plus a system instruction; a reply with no tool call throws and the job retries.
- **Installed `@anthropic-ai/sdk` is 0.39** (latest 1.8): no strict tools, structured outputs, effort or refusal fallbacks. Not upgraded here; BACKLOG line added.
- **Final review found paths where a captured request would never be read**, all fixed with a failing test first:
  - an upload that stored messages but died before announcing the bundle → re-announce on re-upload, plus a 10-minute sweep (`coach-sweep-bundles`) that also retries failed bundles up to 3 times;
  - HEIC attachments reached the model labelled as JPEG (type was guessed from the file name) → use the recorded type;
  - a live message within 3 minutes of a backfilled one joined the historical bundle and became closed history → never mix the two;
  - a failed attachment download was swallowed → retried, skipped only on the last attempt;
  - confirm flipped the status before creating tasks → one multi-row insert, rollback on failure, repair for a confirm that died.
- **History requests could not be replaced** (candidates were only `new`/`confirmed`) → `closed` is now a candidate.

## What to remember

- **Not run yet:** migration 038 is unapplied, and `scripts/coach-interpret-fixture.ts` and `scripts/coach-e2e.ts` have never executed. The devbox has no database, API key or `psql`.
- **Model is `claude-opus-5-5`** (`INTERPRET_MODEL`). The reviewer argued for Sonnet 5.5 at half the cost; undecided.
- "Today" for resolving deadlines is the server's UTC date. From late afternoon US time, "by today" resolves a day late. Fix before reminders ship.
- A bundle misread as ordinary chat has no "Fix it" path until the chat thread exists (plan 3).
- Deferred minors: selects without a limit hit PostgREST's 1000-row cap (tasks, requests, project seed); `/tasks/:id/sent` has no state or blocked check; `PATCH /tasks` ignores `projectId`/`withPersonId`; a date like `2026-13-45` becomes a 500; any non-empty answer drops the ask task; bundle claim is not atomic; a retried store step can duplicate Library clips; a model-named project is created before confirm.
- `lore` and `~/dev/wiki` are not on this devbox: the spec, plan, decision and devlog index rows were added by hand, and the forced-tool-call lesson has not been written to the dev wiki.

## After the server core (same day)

The other five plans of build 1 were written, built test-first, reviewed by a fresh reviewer each, and fixed. All of it is unit-tested and typechecked only.

- **Plan 2, reminders and push** ([plan](../superpowers/plans/2026-11-14-creative-coach-1a-reminders.md), [ADR 0055](../decisions/0055-coach-reminders-minute-cron-with-claim-by-update.md)): reminder planner with timezone and quiet hours, minute cron that claims and sends, weekly review, settings and health (`e481327`, fixes `77eaef3`, `75cb186`). Migration `039`.
- **Plan 3, chat** ([plan](../superpowers/plans/2026-11-14-creative-coach-1a-chat.md), [ADR 0056](../decisions/0056-coach-chat-thread-rows-typed-buttons-and-a-bounded-agent.md)): the thread, typed button actions, Up next, learned rules, the tool-calling agent, the bot's "what I'm doing" line (`d58c562`, fixes `aacbca1`). Migration `040`.
- **Plan 4, phone** ([plan](../superpowers/plans/2026-11-14-creative-coach-1a-phone.md)): Library / plus / Chat bar, chat screen, request, task, Up next, project and setup pages, notifications, Send to Chat (`f1b698d`, `dd3e72f`, fixes `3885f48`).
- **Plan 5, Mac helper** ([plan](../superpowers/plans/2026-11-14-creative-coach-1a-mac-helper.md), [ADR 0057](../decisions/0057-mac-helper-reads-messages-with-node-sqlite-and-an-api-key.md)): `apps/mac-helper` reads `chat.db`, uploads, heartbeats (`5739eb3`, fixes `d7a56d6`). Migration `041`.
- **1b** ([plan](../superpowers/plans/2026-11-14-creative-coach-1b-working-hours.md), [ADR 0058](../decisions/0058-coach-check-ins-as-chat-messages-and-three-tier-filing.md)): working hours, check-ins, focus, progress photos (`6317197`, `ced326c`). Migration `042`.

Tests at the end: `pnpm vitest run apps` → 1399 passed; the 3 failing tests in 5 files are the ones that fail before any of this work.

### Issues found by review and fixed

- **Reminders:** a re-plan re-fired an already-answered reminder for a task due today; the timezone defaulted to UTC (09:00 reminders at 01:00 in Los Angeles), so nothing is planned until the phone reports one; write failures were silent, so a 10-minute reconcile plans any dated task with no reminder; a failed push stranded the rest of its batch.
- **A locked phone cannot report that a push arrived.** The first design re-sent after 10 unreported minutes and counted it as a failure, which would nag every pocketed phone. Re-sends now happen only after 2 unanswered hours, and "not reaching your phone" comes from the push service refusing the message.
- **Chat:** a snoozed reminder never reappeared in chat (its identity now includes when it fired); the agent's tools re-ran on a job retry (no retries; the reply is the server's own account of what was done); a failed action spent the button (it is given back); a failed save looked like "already said".
- **Phone:** opening Messages marked a task sent; an offline launch hid Chat (the thread is now saved on the phone); a share that opened the app skipped Send to Chat.
- **1b:** check-ins could reach five a day with the last two 90 minutes apart (the photo ask now shares the budget of four and the two-hour spacing); a typed answer to the morning check-in was forgotten once a later one was ignored; "Switch" left the old focus in place, so a photo could be filed under it silently (the other projects are now one tap away, and `POST /coach/focus` exists); a settings read error fell back to defaults (it now fails); one person's bad settings stopped check-ins for everyone after them.
- **Mac helper:** messages arriving during a history import were buried as history; one bad attachment could block a thread for ever; old messages re-synced from iCloud were treated as new; a typed "(555) 123-4567" never matched Messages (numbers are now stored as `+15551234567`).

### What to remember (added)

- **Nothing has run for real.** Apply migrations `038`–`042` in order with `psql -f`, then follow `docs/RESUME.md`.
- **The phone needs a native rebuild** (share extension now takes 6 images plus text).
- **The mobile app must report its timezone** before any reminder is planned; it does this on launch. `GET /coach/health` shows `timezoneSet`.
- **Model calls:** bundle reading and chat use `claude-opus-5-5`; history import and rule learning use `claude-haiku-5-5`. The Sonnet question is still open.
- **No background notification task.** A locked phone that received a push still shows the local backup 15 minutes later unless the app was opened. Revisit on a device (needs `expo-task-manager`).
- **Not built:** a "Fix it" for a bundle misread as ordinary chat; corrections to a filing becoming learned rules; a location or calendar signal for focus; the client's window and the AI doing the work (builds 2–4).
- Each plan's ledger, with every ruling and deferred minor, is in `.superpowers/sdd/` on devbox2 (git-ignored).
