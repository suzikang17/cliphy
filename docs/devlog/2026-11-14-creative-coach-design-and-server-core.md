---
day: 69
date: 2026-11-14
phase: Growth
title: "Day 69 — Creative coach: design, and the server core (capture → requests → tasks)"
---

**Cliphy starts growing into a coach for creatives. Designed build 1 with mockups, then built its server core: captured messages become confirmed requests with history and a chain of do/tell/ask/get tasks. Unit-tested only; nothing has run against a database or the model yet.**

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
