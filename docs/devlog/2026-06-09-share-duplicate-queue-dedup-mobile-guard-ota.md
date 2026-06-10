---
day: 64
date: 2026-06-09
phase: Growth
tags: [bugfix, server, mobile, infra]
title: "Day 64 — Share-to-Cliphy triple-queue dedup, mobile re-entry guard, EAS Update OTA"
---

## TL;DR

"Share to Cliphy" queued the same video three times. Root cause was two bugs
stacking: the mobile share handler re-fired 2–3× (async intent reset), and the
server's duplicate check was a TOCTOU race that let all three inserts through.
Fixed the server with a time-windowed atomic guard (shipped), fixed the mobile
re-entry (rides the next build), and set up EAS Update so future JS-only fixes
ship over the air without a build.

## What got done

- **Server windowed dedup (shipped).** Replaced the racy `SELECT`-then-`INSERT`
  duplicate check with: a sliding-window fast-path check, a `dedup_bucket`
  column + partial unique index on `(user_id, youtube_video_id, dedup_bucket)`
  as the atomic backstop, and a `23505` → `409 DUPLICATE` handler. Re-summarizing
  later is still allowed (different bucket). `DEDUP_WINDOW_SECONDS = 60` in
  `@cliphy/shared`. (`13918ef`, ADR 0039)
- **Migration 014 applied to prod.** Collapsed the existing 3 duplicate rows
  (kept earliest, soft-deleted 2), added the column + index. Verified live: 0
  remaining active duplicates.
- **Idempotent ingest.** Enqueue now sends Inngest event `id:
summarize-${summaryId}` so at-least-once delivery can't double-process; retry
  keeps its own event, so re-summarize still runs.
- **Mobile re-entry guard (pending build).** `app/_layout.tsx` resets the share
  intent _synchronously_ before the async enqueue + a `processingShareRef`
  guard → one share = one request. Added a typed `DuplicateError` so a `409`
  renders as a calm "Already in your queue" instead of an error alert.
- **EAS Update / OTA setup (pending first build).** Installed `expo-updates
~55.0.24`, added `updates.url` + `runtimeVersion: fingerprint` to `app.json`,
  and `channel`s to all three `eas.json` build profiles. After one more native
  build embeds it, future JS-only fixes ship via `eas update --channel …`.

## Decisions

- **ADR 0039** — Windowed atomic dedup (bucket column + partial unique index)
  over a permanent unique constraint (blocks re-summarize) or an app-only check
  (still racy). Advisory-lock RPC held in reserve for the boundary case.
- **Runtime version policy = `fingerprint`** — auto-ties each OTA bundle to
  compatible native builds, so a JS update can't land on a mismatched binary.

## Issues

- `extract(epoch from timestamptz)` is not `IMMUTABLE`, so a created_at
  expression index is rejected (Postgres 42P17) — hence the app-computed
  `dedup_bucket` column instead of a pure-DB expression.
- Bucket boundary: a duplicate pair straddling a 60s boundary (~0.5% for a
  sub-second burst) can still slip the index. Mitigated because the client guard
  now sends one request per share; advisory-lock RPC is the escape hatch.

## What to remember

- The server fix is the real fix — duplicate _rows_ are now impossible within
  the window regardless of client version. Old app builds just see the friendly
  409 on their stray re-fires.
- OTA needs **one more native build** to take effect; `expo-updates` is inert in
  the dev client, so local testing (`pnpm dev:mobile`) is unaffected.
- To test the server window end-to-end, point the app at a local server
  (`pnpm dev:server`) or wait for the prod deploy — the prod API only got the
  new behavior with this push.

---

## Commits

- `13918ef` — add windowed atomic dedup to queue enqueue (server + shared + migration 014)

Mobile changes (re-entry guard, `DuplicateError`, `expo-updates`/OTA config) are
staged for the next mobile build, not yet committed.
