---
title: "Liked-videos auto-subscription via videos.list myRating=like (Watch Later considered unreliable)"
date: 2026-06-10
category: Tech
revisit: false
---

## Why this choice

We want low-friction mobile capture: like a video inside YouTube → it shows up
in the Cliphy queue. Two API routes were considered for reading a user's likes:

- **`videos.list?myRating=like`** (chosen) — documented, supported endpoint;
  works with the `youtube.readonly` OAuth scope we already request; returns the
  full video snippet directly (no second lookup).
- **`playlistItems.list` on the `LL` playlist** — undocumented for third
  parties and in the same family as `WL`/`HL`, which Google cut off in
  September 2016. Too fragile to build on.

The new `liked` subscription type reuses the entire auto-subscriptions
pipeline (15-min Inngest poll, seen-video snapshot dedup, per-user limits).
On creation we snapshot current likes so only _future_ likes get queued.

## Watch Later doubt

Per Google's API revision history (Aug 11 2016), `playlistItems.list` on `WL`
returns an **empty list even for the authenticated owner**. Our shipped
`watch_later` type has never been exercised in prod (0 subscriptions, 0
connected Google accounts as of 2026-06-10), so it is presumed dead pending a
smoke test with a real token (CLIP-112). If confirmed empty, the UI option gets
removed; `liked` is the replacement for the same "save it for Cliphy" gesture.

## What to remember

- `publishedAt` on liked videos is the video's publish date, not the like
  date — irrelevant because dedup is snapshot-based, but don't sort by it.
- Google disconnect deactivates both `watch_later` and `liked` subscriptions.
- Playlist polls now use the user's Google token when connected (falls back to
  the public API key), so a **private** "Cliphy" playlist works as a capture
  target.
