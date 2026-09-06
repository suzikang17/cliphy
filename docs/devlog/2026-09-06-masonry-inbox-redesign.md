---
title: "Masonry inbox redesign — the beautiful display experience"
date: 2026-09-06
phase: "Clipping-platform pivot (subproject #4 — final)"
---

**Shipped subproject #4, the final piece of the clipping-platform pivot: the inbox is now a two-column masonry feed of polished per-type cards. All four subprojects are done.**

## What got done

- `lib/masonry.ts`: `heightEstimate(clip)` (per-type relative height) + `splitColumns`
  (greedy shortest-column bin-packing, order-preserving). Unit-tested.
- `components/MasonryFeed.tsx`: renders the two balanced columns of `ClipCard`s.
- Card polish: images now size to content via `style={{ aspectRatio }}` (web 16:10,
  tweet media 4:3, image 3:4, youtube 16:9) instead of fixed pixel heights; `QueueCard`
  restructured from a side-thumbnail row to a full-width top thumbnail with the status
  dot; source glyphs (▶ 🔗 🐦 🎧 🖼) via `lib/clipGlyph.ts`.
- `app/(tabs)/index.tsx`: swapped the `FlatList` for `ScrollView` + `MasonryFeed`;
  search, category chips, pull-to-refresh, capture "+", clipboard banner, and Realtime
  all preserved. Empty/search-empty states render `EmptyState`.

## Decisions

- Pure-JS masonry over a native library so the redesign ships OTA (no rebuild). See
  ADR 0046. FlashList masonry deferred until library scale demands virtualization.
- Design chosen from an interactive mockup comparing masonry / list / grouped; user
  picked masonry for iOS.

## Issues

- None new. Column balance uses estimated (not measured) heights — tunable in
  `heightEstimate` if columns look uneven in practice.

## What to remember

- `MasonryFeed` re-splits on every render; cheap at personal scale. To virtualize
  later, replace its two-column body with FlashList masonry behind the same props.
- Image aspect ratios are set via `style={{ aspectRatio }}` (not NativeWind arbitrary
  classes) for cross-version safety.
- This completes the pivot: (1) universal URL/tweet capture, (2) image OCR,
  (3) enrichment + related + semantic search, (4) masonry inbox.

---

## Commits

- feat: add masonry height estimate and two-column split
- feat: add MasonryFeed two-column layout component
- feat: polish clip cards for masonry: content-height images, source glyphs
- feat: swap inbox to two-column masonry feed

## Pivot complete

Cliphy is now a universal clipping platform: capture anything (YouTube, podcasts,
web articles/pages, tweets, screenshots/photos) → AI-enriched (summary, consistent
tags, category) → browsable as a masonry inbox with related-clips and semantic
search. Remaining backlog: PDF/video capture, auto-detect screenshots, orphaned-upload
cleanup, full multi-tweet threads, FlashList virtualization, and a web-app pass.
