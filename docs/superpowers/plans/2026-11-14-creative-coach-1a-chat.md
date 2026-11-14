---
date: 2026-11-14
title: Creative coach 1a, plan 3 — the chat thread, bot actions, Up next and learned rules
---

# Creative Coach 1a, Plan 3 — Chat Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One chat thread per user where the bot reports what happened (a request arrived, a reminder is due, a task unblocked, a reply came in), the user answers with a button or free text, and the bot acts on it; plus the data for Up next and a visible list of what the bot has learned.

**Architecture:** Bot messages are rows written by the existing jobs through pure message builders, de-duplicated per source so nothing is said twice. Buttons carry a typed action the server executes through the same functions the HTTP routes use. Free text is stored, then answered by an Inngest job running Claude in a tool loop over those same functions. Learned rules are plain sentences in a table, fed into both the bundle reading and the chat, and only ever created visibly.

**Tech Stack:** Hono, Supabase, Inngest v4, `@anthropic-ai/sdk` 0.39 (`tool_choice: auto`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md` (sections 4, 6, 7 and the copy rules). Builds on plans 1 and 2; their Global Constraints apply unchanged.

## Global Constraints

- Everything in plans 1 and 2.
- Copy rules bind every bot message: state the fact and stop; keep who asked, what for and by when; buttons are one word where possible, two at most, and at most three per message; no name tag; no filler.
- The bot never acts on something it has not shown: every action it takes on the user's behalf produces a message saying what it did.
- No hidden learning: a rule exists only if it is in `coach_rules`, and creating one posts a message with an Undo.
- The same thing is never said twice: a bot message with a `(kind, refId)` already in the thread is not posted again.
- Chat model: `claude-sonnet-5-5` (built on Opus 5.5, switched at the owner's request); rule extraction: `claude-haiku-5-5`. Both are single constants.

## Review Focus

1. **A job retries after posting its message:** the thread shows one message, not two.
2. **A button is tapped twice, or after its action is no longer valid** (the request was already confirmed elsewhere): no second effect, and the message shows what was chosen.
3. **The model calls a tool with an id that is not the user's, or invents one:** the tool refuses; nothing is written.
4. **The model loops or never stops calling tools:** the run ends after a fixed number of turns with a plain message.
5. **Free text that changes nothing** ("thanks"): one short reply, no tool calls required, no task created.

## Tasks

### Task 1: Thread storage

`040_coach_chat.sql`: `coach_chat_messages` (`id`, `user_id`, `role` in `bot|user`, `text`, `attachments jsonb`, `buttons jsonb`, `link jsonb`, `chosen int`, `kind text`, `ref_id text`, `created_at`; unique `(user_id, kind, ref_id)` where `ref_id is not null`; index `(user_id, created_at)`), `coach_rules` (`id`, `user_id`, `sentence`, `person_id`, `project_id`, `active boolean default true`, `source_message_id`, `created_at`).

Shared types: `ChatAction` (a tagged union: `answer_request`, `confirm_request`, `fix_request`, `task_state`, `task_sent`, `snooze`, `close_ask`, `undo_rule`, `open`, `dismiss`), `ChatButton { label, action }`, `ChatLink { type: "request" | "task" | "project" | "upnext" | "setup"; id?: string }`, `ChatMessage`, `CoachRule`.

`services/coach/chat.ts`: `postBotMessage(userId, msg)` (upsert on the dedupe key with `ignoreDuplicates`, returns the id or null when it already existed), `postUserMessage`, `listMessages(userId, { after?, limit })`. Route `GET /coach/chat?after=&limit=`.

### Task 2: What the bot says (pure builders) and when

`services/coach/botMessages.ts` — pure functions returning `{ text, buttons, link, attachments, kind, refId }`: `requestArrived`, `replyArrived`, `reminderDue`, `taskUnblocked`, `weeklyReview`, `pushNotWorking`, `ruleLearned`, `didAction`. Hooks: `processBundle` (request and reply), `fireReminders` (each reminder sent, and push health when failures reach 2), `weeklyReview`, and task completion (unblocked dependents).

Text is pinned in tests, for example: a request with a question → the understood sentence, a line break, the question; buttons are the question's options. A request without one → buttons `Looks right`, `Fix it`. A reminder for a `do` task → reminder body with the title, buttons `Start`, `Done`, `Tomorrow`.

### Task 3: Actions

`services/coach/actions.ts`: `confirmRequest`, `fixRequest`, `setTaskState`, `markTaskSent`, `snoozeTask`, `closeAsk`, extracted from the routes (which now call them) and each returning `{ ok: true, … } | { ok: false, status, error }`. `executeAction(userId, action)` dispatches a `ChatAction`. Route `POST /coach/chat/:id/choose { index }`: runs the button's action once (guarded on `chosen is null`), records `chosen`, and posts a `didAction` message when the action changed something.

### Task 4: Up next

`services/coach/upNext.ts`: pure `buildUpNext(tasks, people, projects, today)` → `{ strip: { thisWeek, next }, overdue, thisWeek: [{ date, tasks }], later, waiting, errands: [{ place, tasks }], backBurner: { count, titles }, byProject: [{ project, state, next }] }`. Route `GET /coach/upnext`.

### Task 5: Learned rules

Routes `GET /coach/rules`, `PATCH /coach/rules/:id`, `DELETE /coach/rules/:id`. `InterpretContext.rules: string[]` is filled from active rules and shown to the model. Inngest `coach-learn-from-answer` (event `coach/answer.given`): asks the small model whether the answer implies a durable rule; if so inserts it and posts `ruleLearned` with an `Undo` button.

### Task 6: Free text

`services/coach/agent.ts`: the tool definitions (`answer_request`, `confirm_request`, `fix_request`, `create_task`, `update_task`, `mark_sent`, `list_up_next`, `search_library`, `remember`), a context builder, and `runAgent(userId, text)` — a loop of at most 6 model turns that executes tool calls through `actions.ts` and returns the final text. Inngest `coach-chat-reply` (event `coach/chat.message`, one at a time per user) runs it and posts the reply. Route `POST /coach/chat { text }` stores the message and sends the event (202).

### Task 7: Docs

ADR, architecture section, devlog.
