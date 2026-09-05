---
title: "Universal clip capture — URL ingest, web + first-class tweets"
date: 2026-09-05
phase: "Clipping-platform pivot (subproject #1)"
---

**Shipped subproject #1 of the clipping-platform pivot: `POST /api/clips` now ingests any URL, auto-detecting web pages (article/visual) and tweets, with shared AI enrichment and per-type mobile cards.**

## What got done

- Extended shared types: `SourceType` gained `"web"`; added `ClipCategory`,
  `TweetClipMetadata`, `TweetMedia`, `WebClipMetadata`, and `SOURCE_TYPES` /
  `CLIP_CATEGORIES` runtime constants; `Summary` gained `category`,
  `heroImageUrl`, `excerpt`.
- Migration `024_universal_clips.sql`: added a `source_type` check constraint
  (none existed) including `web`, plus `category` / `hero_image_url` / `excerpt`
  columns and a `category` index. Applied to prod.
- `detectSourceType` — pure URL classifier (youtube / tweet / web).
- `web` extractor — fetch + `@mozilla/readability` + `linkedom`, auto-detecting
  article (≥500 chars → reading text + reading time) vs. visual (og:image +
  description). Proxies via Decodo only on 403/429.
- `tweet` extractor — Twitter syndication API primary, FixTweet fallback;
  returns text, author, media, quoted tweet, stats.
- `enrich` service — Haiku (`claude-haiku-4-5-20251001`) produces summary + 2-4
  tags + a category; `parseEnrichment` tolerates fenced JSON and invalid categories.
- Universal `/api/clips` route: detect → extract → save → fire
  `clip/embed.requested`; extractor failures still save a `failed` clip (nothing lost).
- `embed-clip` worker: enriches web/tweet clips (writes category/tags/summary)
  before embedding, syncing the in-memory row so the embed text uses the fresh summary.
- Mobile: `addClip` API method; share intent widened from YouTube-only to any URL;
  `ClipCard` dispatcher + `WebCard` + `TweetCard`; category filter chips in the inbox.
- Live smoke tests (`RUN_CLIP_SMOKE=1`) — verified real Wikipedia article and real
  tweet extraction end-to-end; both green.

## Decisions

- Tweet fetching uses the free Twitter syndication API + FixTweet fallback, not the
  paid X API — see ADR 0043. Marked revisit-worthy since the endpoints are undocumented.
- Enrichment reuses the existing Haiku tier (matches the auto-tag service) rather than
  Sonnet — this is lightweight triage, not full summarization.
- `category` is freeform `text` at the DB level (not an enum) so the AI vocabulary can
  evolve without a migration.

## Issues

- **Forward self-thread stitching isn't feasible via free endpoints.** A live probe
  showed `tweet-result` returns only the single tweet + `conversation_count`, not the
  thread's forward children. Captured the root tweet reliably (`threadTweetIds =
[rootId]`) and deferred full-thread capture to the screenshot-OCR path (subproject
  #2). Documented in ADR 0043.
- **Pre-existing latent bug (not fixed here):** the mobile inbox Realtime subscription
  in `app/(tabs)/index.tsx` still listens to `table: "summaries"`, but migration 022
  renamed the table to `clips`. Live updates likely don't fire for any clip type. Left
  out of this feature's scope to avoid scope creep — should be its own fix.

## What to remember

- The DB table is `clips`; `types.ts` comments and `toClip` still say "summaries" for
  backwards-compat naming. `toClip` maps `youtube_video_id` → `videoId`.
- Server relative imports need the `.js` extension (NodeNext ESM).
- Tests run from repo root: `pnpm vitest run <path>`. Smoke tests are opt-in via
  `RUN_CLIP_SMOKE=1`.

---

## Commits

- feat: add web source type, clip categories, and per-type metadata types
- feat: add universal clip columns and map them in toClip
- feat: add detectSourceType URL classifier
- feat: add web clip extractor with article/visual auto-detection
- feat: add tweet extractor with syndication API and FixTweet fallback
- feat: add clip enrichment service (summary, tags, category)
- feat: make POST /api/clips a universal url ingest with type routing
- feat: enrich web and tweet clips before embedding
- feat: mobile accept any shared url via universal addClip
- feat: mobile per-type clip cards and category filter in inbox

## Tomorrow's plan

- Subproject #2: screenshot / image OCR capture (also the tweet-thread & X-URL-in-image
  fallback).
- Fix the `summaries`→`clips` Realtime table-name bug.
- Subproject #4: the polished inbox redesign.
