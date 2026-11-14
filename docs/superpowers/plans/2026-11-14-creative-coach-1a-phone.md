---
date: 2026-11-14
title: Creative coach 1a, plan 4 — the phone screens
---

# Creative Coach 1a, Plan 4 — Phone Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coach is usable from the phone: a Library / plus / Chat bar, the chat thread with buttons and typing, a request page, a task page with its kit, Up next, project history, Setup, reminders that report delivery, and "Send to Chat" from the share sheet.

**Architecture:** Screens are thin: everything they decide (merging polled messages, what local notifications to schedule, which setup steps remain, how to open Messages with a draft) lives in pure functions in `apps/mobile/lib/coach.ts` with unit tests, and all server access goes through one typed client, `lib/coachApi.ts`. Screens for people without the coach switch are unchanged apart from the bar.

**Tech Stack:** Expo 55, expo-router, NativeWind, expo-notifications, expo-share-intent, Vitest for `lib/`.

**Spec:** `docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md` ("Navigation and look", sections 4, 6, 8) and the mockups beside it (`setup.html` is the reference for line weight). Server contract: plans 1–3.

## Global Constraints

- Look: light neo-brutalist. Outlines 1.5px black; hard 2px shadows only on bot message cards, Library clips and the plus button; lists are flat rows with a hairline; DM Sans; nothing under 11px; filled buttons use `neon[700]`.
- Copy rules: buttons one word where possible, two at most; a row is a title plus one short detail; no label repeats the row; no name tag on bot messages. Text comes from the server; screens add none of their own beyond headings and empty states.
- Navigation: Library on the left, a round plus in the middle, Chat on the right (Chat only for accounts with the coach switch). Settings, Setup and Learned sit behind the avatar. Request, task, project and Up next are pushed pages with no tab.
- The app reports its timezone to the server on launch; the server plans no reminders until it has one.
- A received reminder is reported (`/delivered`); a tapped or answered one is acknowledged (`/ack`).
- Accounts without the switch must see no coach UI and make no coach calls after the first refusal.
- This plan cannot be run on a device from the build machine. Every task ends with `pnpm -C apps/mobile typecheck` and the `lib/` unit tests; device verification is owed and listed at the end.

## Review Focus

1. **Account without the coach switch:** the first coach call returns 403; nothing coach-related renders or polls afterwards.
2. **Polling while a button tap is in flight:** the tapped state is not overwritten by a stale poll.
3. **A reminder arrives by push and its local backup is also scheduled:** the user sees one notification.
4. **Send on a tell/ask task with no phone number for the person:** the draft is still usable (copied), and the task is not marked sent by accident.
5. **App opened with no network:** the thread shows what it had, and typing is not lost.

## Tasks

1. **Client and logic.** `lib/coachApi.ts` (every `/api/coach/*` call, typed with `@cliphy/shared`); `lib/coach.ts` pure helpers (`mergeMessages`, `newestTime`, `isCoachOff`, `smsUrl`, `mirrorPlan`, `setupSteps`, `dayParts`) with tests. Server: `POST /coach/health/test-push`.
2. **Bar and Library chrome.** Custom tab bar (Library, plus, Chat); Queue renamed Library; avatar opens Settings; "Following" row and a Podcasts chip replace the two removed tabs (their screens stay routable).
3. **Chat.** `app/(tabs)/chat.tsx`: thread, strip (from `/coach/upnext`), buttons, typing, polling every 4 s while focused, optimistic user message.
4. **Request and task pages.** `app/coach/request/[id].tsx` (what was sent, what was understood, the question, what it replaces, Looks right / Fix it) and `app/coach/task/[id].tsx` (kit; Start/Done, Send via Messages, Got it with checklist).
5. **Up next and project history.** `app/coach/upnext.tsx` (by date / by project) and `app/coach/project/[id].tsx`.
6. **Setup and Learned.** `app/coach/setup.tsx`: the four first-run steps, connection health, people, learned rules.
7. **Notifications.** Report timezone; report delivery; acknowledge on tap and route to Chat; mirror upcoming reminders as local notifications two minutes late and cancel the copy when the push arrives.
8. **Send to Chat.** Share sheet accepts several images plus text; after sharing, choose a person to send it to the bot as a request, or save to Library as today.
