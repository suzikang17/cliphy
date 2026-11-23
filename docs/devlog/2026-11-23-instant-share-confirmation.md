---
lore_type: devlog
created: 2026-11-23
title: "Day 75 — Sharing a link confirms at once; the save is one database call; tokens checked on the server"
date: 2026-11-23
day: 75
phase: Growth
---

**Sharing a YouTube link took a few seconds to confirm. The phone now confirms from a local outbox and sends after; the server save went from seven calls in a row to one database function plus the Inngest event; and signed-in requests no longer start with a call to Supabase. All deployed. Not yet timed on a phone.**

## What got done

- **Found the chain** behind the wait: app start → "does this account have the coach?" call → `getUser` call to Supabase → 7 sequential DB/Inngest calls → alert.
- **First pass** (`93d7661`): a bare link no longer waits on the coach check; three reads ran together; queue position only for `POST /queue`.
- **Outbox on the phone** (`6d1c74f`, [ADR 0069](../decisions/0069-shared-links-confirm-on-the-phone-first.md)): `lib/shareOutbox.ts` stores the link in AsyncStorage, the app says "Saved to Cliphy", then sends. It retries on sign-in and each time the app comes forward; duplicates drop quietly; refusals show the usual alert. `apiFetch` errors now carry `status`. 12 tests.
- **One-call save** (`6f57fb9`): migration `049_enqueue_video.sql`; `enqueueVideo` is one `rpc` plus `inngest.send`. The SQL is tested in an embedded Postgres (`enqueue-video.sql.test.ts`, 10 tests, new dev dependency `@electric-sql/pglite`). Queue route tests were rewritten around the single call.
- **Tokens checked locally** (`644c7c2`, [ADR 0070](../decisions/0070-check-sign-in-tokens-on-the-server.md)): `authMiddleware` uses `getClaims`. `auth-jwt.test.ts` signs real ES256 tokens and counts network calls: none to `/auth/v1/user`.
- **Verified in production:** both server deploys succeeded (a failed migration stops the build, so 049 is applied). Garbage, expired and forged-with-the-real-key-id tokens each get 401 from `api.cliphy.app`. Against the real project, a forged token was rejected after fetching only the JWKS.

## Issues

- **`getClaims` throws on an expired token** (a plain `Error`, not an auth error), which would have been a 500 instead of the 401 the apps use to renew their sign-in. Caught by the real-signature test; the middleware now turns any throw into 401.
- The pre-commit `git pull --rebase` refused once because another session had unstaged edits in the same checkout; fetched and pushed my commit only.

## What to remember

- The outbox says "Saved" before the server has the link. A refusal (monthly limit) arrives as a second alert a moment later.
- Whether live tokens are ES256 or still HS256 was not confirmed (needs a real token). If HS256, the local check falls back to asking Supabase and gains nothing until the signing key is switched in Supabase → JWT Keys.
- A signed-out session stays valid until its token expires (≤ 1 hour).
- Three server tests fail on this devbox regardless (libvips missing, live smoke tests).

---

## Commits

- `93d7661` save a shared link sooner
- `6d1c74f` confirm a shared link at once, send it after
- `6f57fb9` save a YouTube link in one database call
- `644c7c2` check sign-in tokens on the server, not by asking Supabase

## Tomorrow's plan

- Share a video from YouTube on the phone and see how fast "Saved" appears; share once in airplane mode and confirm it goes out on reopening.
