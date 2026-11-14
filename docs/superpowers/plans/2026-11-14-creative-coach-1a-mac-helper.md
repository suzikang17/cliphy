---
date: 2026-11-14
title: Creative coach 1a, plan 5 — the Mac helper
---

# Creative Coach 1a, Plan 5 — Mac Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A small background program on the owner's Mac reads the Messages history for the people she marked, uploads new messages and their attachments to the coach, and reports that it is alive.

**Architecture:** `apps/mac-helper` is a dependency-light Node 22 program (built-in `node:sqlite`, `fetch`). One sync cycle is a pure-ish function over injected parts (a message reader, the API, a state file, an image converter, a clock), so everything except reading the real `chat.db` and running `sips` is unit-tested on any machine. It authenticates with an existing Cliphy API key. The server gains a heartbeat; the phone's Setup page chooses whose thread is captured and how far back.

**Tech Stack:** Node 22 (`node:sqlite`, `fetch`, `child_process` for `sips`), TypeScript run with `tsx`, launchd, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md` (section 1, Capture; section 8, Setup). Server contract: plan 1 (`/coach/intake/*`, `/coach/people`).

## Global Constraints

- Reads `~/Library/Messages/chat.db` read-only. Never writes to it.
- Only one-to-one threads, and only for people with `captureThread` on. Both directions are uploaded (hers and theirs).
- Attachments go up at full quality. HEIC is converted to JPEG (`sips`), because the bot cannot read HEIC. Non-image attachments are skipped and counted.
- A message is identified by its Messages `guid`; re-uploading is harmless (the server ignores duplicates), so the cursor advances only after the server accepts a batch.
- First connecting a person follows that person's history choice: new messages only, a window of days, or the whole thread. Anything read from the past is sent with `historical: true`.
- The API key and the cursor live under `~/.cliphy-helper/`, readable only by the user (`0600`).
- Reading Messages needs Full Disk Access, granted by hand. `check` must say so plainly when it is missing.
- This plan cannot be run against a real Messages database from the build machine (it is Linux). The reader is tested against a fixture database with the same schema; a run on the Mac is owed.

## Review Focus

1. **The upload fails half-way through a batch:** nothing is skipped on the next cycle, and nothing is duplicated on the server.
2. **A message with no `text` column** (newer macOS stores it in `attributedBody`): the words are still captured.
3. **A group chat that includes a captured person:** not uploaded.
4. **An attachment that is still downloading or missing on disk:** the message still goes up, without it.
5. **The Mac was off for a week:** it catches up in order, in bounded batches.

## Tasks

1. **Pure parts.** `src/convert.ts` (`appleTimeToIso`, `textFromAttributedBody`), `src/plan.ts` (`firstSync`, `toIntakeMessage`), with tests.
2. **Reading Messages.** `src/messagesDb.ts` (`openMessages`, `readThread`, `maxRowId`), tested against a fixture database built in the test with the real column names.
3. **The sync cycle.** `src/sync.ts` (`syncOnce`) over injected parts, with tests for every Review Focus line.
4. **Server heartbeat.** `POST /coach/intake/heartbeat`, `helper_seen_at` on `coach_settings` (migration `041`), `helperSeenAt` in `/coach/health`.
5. **The program.** `src/api.ts`, `src/images.ts`, `src/state.ts`, `src/main.ts` with `login`, `check`, `once`, `run`, `install` (launchd), and a README.
6. **Phone.** Setup: choose whose thread is captured and how far back; show when the Mac was last seen.
