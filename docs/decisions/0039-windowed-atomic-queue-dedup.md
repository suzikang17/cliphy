---
title: "Windowed atomic dedup for queue enqueue over a permanent unique constraint"
date: 2026-06-09
category: Tech
revisit: false
---

## Why this choice

The `POST /api/queue` duplicate check was an application-level `SELECT … WHERE
user_id = … AND youtube_video_id = … AND status <> 'failed'` followed by an
`INSERT`. That is a TOCTOU race: concurrent requests all run the SELECT before
any INSERT commits, so every one of them inserts. The mobile share sheet firing
its handler 2–3× before the share intent reset triggered exactly this — one
video, three `completed` rows created within 290ms.

The fix needs two properties at once:

1. **Atomic** — only the database can stop concurrent inserts; an app-level
   check never can.
2. **Time-bounded, not permanent** — a user must still be able to re-summarize
   the same video later, so we can't forbid all duplicate `(user, video)` rows
   forever.

We settled on a per-time-window atomic guard: each insert stamps a
`dedup_bucket = floor(unix_time / DEDUP_WINDOW_SECONDS)`, and a partial unique
index on `(user_id, youtube_video_id, dedup_bucket)` (for active rows) makes
concurrent inserts in the same bucket collide. One writer wins; the rest get a
`23505` the handler maps to `409 DUPLICATE`. A later enqueue lands in a new
bucket and is allowed.

## Options considered

- **Permanent partial unique index** on `(user_id, youtube_video_id)` for active
  rows. Atomic and simplest, but permanently blocks re-summarizing a video —
  rejected on product grounds.
- **App-level windowed SELECT only** (`created_at > now() - window`). Allows
  re-summarize, but still racy — the 290ms triple-fire slips straight through.
- **created_at expression index** `floor(extract(epoch from created_at)/60)`.
  Needs no extra column, but `extract(epoch from timestamptz)` is not
  `IMMUTABLE`, so Postgres refuses it in an index expression (verified: error
  42P17). Hence the app-computed `dedup_bucket` column.
- **Advisory-lock RPC** (`pg_advisory_xact_lock` + sliding-window check +
  insert). True sliding window, no bucket boundary effect, but a plpgsql
  function and composite return to maintain. Held in reserve if boundary slips
  ever matter.
- **Chosen: app-computed bucket column + partial unique index**, plus a
  sliding-window SELECT as a fast path and an idempotent Inngest event id
  (`summarize-${summaryId}`) so at-least-once delivery can't double-process.

## Tradeoffs

- **Boundary effect:** buckets are fixed windows, so a duplicate pair straddling
  a bucket boundary (~0.5% for a sub-second burst) can slip the index. Accepted
  because the client guard now sends one request per share, removing the burst
  at the source; the advisory-lock RPC is the escape hatch if it ever bites.
- **Extra column:** `dedup_bucket bigint` on every row — a small, opaque integer
  whose only purpose is the index. Worth it for an atomic guard with no plpgsql.
- **`DEDUP_WINDOW_SECONDS = 60`** is a product knob: long enough to swallow any
  accidental rapid re-submit, short enough that a deliberate re-summarize is
  realistically outside it (and retry reuses the row anyway, bypassing this).
