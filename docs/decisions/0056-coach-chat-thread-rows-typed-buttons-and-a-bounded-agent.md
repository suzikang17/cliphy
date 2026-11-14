---
type: decision
title: "Coach chat: messages as de-duplicated rows, typed button actions, and a bounded tool-calling agent"
date: 2026-11-14
category: Server
revisit: true
---

> Spec sections 4, 6, 7. Plan: [`2026-11-14-creative-coach-1a-chat`](../superpowers/plans/2026-11-14-creative-coach-1a-chat.md).

## Why this choice

The chat thread is the one place the bot speaks and the user answers. Three choices keep it trustworthy:

- **Every bot message is a row with a `(kind, ref_id)` identity**, written by an upsert that ignores duplicates (`postBotMessage`). The jobs that post (bundle reading, reminders, weekly review, task completion) are all retried by Inngest, so "said once" has to be a property of the write, not of the caller. The words come from pure builders in `botMessages.ts`, which is where the copy rules are enforced and tested.
- **Buttons carry a typed action** (`ChatAction`), executed on the server by `executeAction`. A tap is claimed with a guarded update (`chosen is null`) before anything runs, so a double tap acts once. Whatever the action changed is reported back as one short line.
- **Free text is answered by a job, not in the request.** `POST /coach/chat` stores the message and emits `coach/chat.message`; `coach-chat-reply` runs Claude in a tool loop (`runAgent`) of at most 6 turns, one message at a time per user. Tools go through the same service functions as the buttons and HTTP routes (`requestActions`, `actions`, `taskInput`), and every id the model names is checked against what was loaded for that user.

**Learning is only ever visible.** A rule is a row in `coach_rules`. It is created by the agent's `remember` tool or by `coach-learn-from-answer` (a small-model call after a request's question is answered), and both post a "Learned: …" message with an Undo. Active rules are shown to the model when reading a bundle and when chatting.

## Options considered

- **Answer free text inside the HTTP request:** simplest, but a tool loop can take tens of seconds, past what a serverless request should hold, and a dropped connection would lose the reply.
- **Stream the reply:** nicer to watch, but needs a streaming transport to the phone and a newer SDK. The thread polls `GET /coach/chat?after=` instead.
- **Buttons as free text sent back to the model:** one code path, but a tap would cost a model call and could be misread.
- **Fine-tuning or hidden memory for learning:** rejected by the spec ("no hidden learning").

## Tradeoffs

- A typed reply arrives a few seconds after sending, via polling, not instantly.
- The agent's context is rebuilt on every message (requests, up to 40 tasks, people, projects, rules, last 12 messages). Fine at one user's scale; prompt caching is available once the SDK is upgraded.
- Two more model calls exist: one per typed message (`claude-sonnet-5-5`) and one per answered question (`claude-haiku-5-5`).
- A bundle misread as ordinary chat still has no "Fix it" (no request row exists). The user can now tell the bot in chat, but the agent has no tool to re-read a bundle yet.
