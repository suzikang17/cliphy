---
type: decision
title: "Shared links: confirmed from an outbox on the phone, saved in one database call"
date: 2026-11-23
category: Capture
revisit: true
---

## Why this choice

Sharing a YouTube video to Cliphy took a few seconds before "Saved" appeared. The owner wants it right away. The wait was a chain, each link waited on in turn: the app starting, a call to learn whether the account has the coach, the server asking Supabase whether the token is good (ADR 0070), then seven database and Inngest calls one after another, and only then the confirmation.

- **The phone confirms first.** A shared link is written to an outbox in AsyncStorage (`lib/shareOutbox.ts`), "Saved to Cliphy" is shown, and the send follows in the background. The outbox is sent again when signed in and each time the app comes forward, so a link survives the app being put away mid-send, or no network.
- **What happens to a failed send** (`judge`): no answer, a 5xx or an expired sign-in is tried again, up to six times; a link the server already has is dropped quietly; a refusal (monthly limit, a bad link) is dropped and shown with the usual alert.
- **A bare link no longer waits on the coach.** Only pictures and text can be a request for Chat.
- **The save is one database function** (`enqueue_video`, migration 049): duplicate check, plan and bonus, monthly count, language, insert, and the queue position only when asked for. The count and insert share a block, so a share that loses the race to the unique index has its count undone by the database, replacing the hand-written decrement.
- **The SQL is tested as SQL**, in an embedded Postgres (`@electric-sql/pglite`, dev only), against the real `increment_monthly_count`.

## Options considered

- **Only make the server faster.** Honest but never instant: app start and one round trip remain.
- **Confirm before storing anything.** Instant, and loses the link if the app is closed mid-send.
- **A native share extension that posts without opening the app.** The real fix for app start time; a native build and its own sign-in handling. Later, if this is not enough.
- **Cache plan and language on the server.** They already ran beside the duplicate check, so nothing to gain, and a cached plan delays an upgrade.

## Tradeoffs

- "Saved" now means "kept on this phone and on its way". A refusal arrives a moment later as a second alert.
- The confirmation no longer carries the video's title (the server's answer is not waited for). For YouTube it was blank anyway until the summarizer filled it in.
- Nothing on screen says a link is still waiting to be sent (no network). Revisit if that turns out to matter.
- The save's rules now live in SQL. Changing them is a migration, not a code edit.
