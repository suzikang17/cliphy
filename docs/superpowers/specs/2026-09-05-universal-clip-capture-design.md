# Universal Clip Capture — Design Spec

**Date:** 2026-09-05
**Status:** Approved, pre-implementation
**Scope:** Subproject #1 of the "universal clipping platform" pivot

## Context

Cliphy is pivoting from a YouTube/podcast summarizer into a universal
clipping platform: a unified inbox where the user can save _anything_ — URLs,
articles, tweets, design inspiration, (later) screenshots and photos — and get
it back as a beautifully displayed, AI-enriched, searchable clip.

The pivot decomposes into four sequential subprojects, each shipping something
usable:

1. **Universal capture + URL extraction** (articles, tweets) ← THIS SPEC
2. Screenshot / image OCR pipeline
3. AI enrichment improvements (auto-tagging across all types)
4. Display / UX redesign (the beautiful inbox)

This spec covers subproject #1 only. It deliberately builds the ingest
architecture so that image capture (#2) plugs in as just another source type.

The user's three primary use cases motivate the content types:

- Catching up on feeds / instructional YouTube videos
- Capturing business & AI ideas to revisit later
- Curating websites/design that inform their aesthetic & design system

## Goals

- Accept **any URL** via share sheet or in-app paste (not just YouTube).
- Detect source type and route to the right extractor.
- **Web pages**: auto-detect article-like vs. visual/design and extract
  accordingly (clean reading text + hero image, OR title/description/hero image).
- **Tweets/X as a first-class type**: full text, author identity, media,
  quoted tweets, and **whole self-threads** stitched into one clip — via free
  endpoints, no paywalled API.
- Every clip flows into the existing unified inbox, AI-enriched (summary, tags,
  category) consistently across all types.
- New types render decently in the existing list (not the final redesign — that
  is subproject #4).

## Non-Goals (this phase)

- Full-page screenshots of web pages (deferred; text + metadata + hero image only).
- Screenshot / camera / image OCR capture (subproject #2).
- Sprawling multi-author X conversation capture (only single-author threads).
- The polished inbox redesign (subproject #4).

## Architecture

One universal ingest entry point, type detection, fan-out to extractors, then a
shared AI-enrichment worker.

```
POST /api/clips  (universal ingest — any URL)
   │
   ├─ detectSourceType(url)  →  youtube | podcast | tweet | web
   │
   ├─ youtube  → existing pipeline (unchanged)
   ├─ podcast  → existing pipeline (unchanged)
   ├─ tweet    → tweetExtractor  (syndication API → FixTweet fallback; stitch self-threads)
   └─ web      → webExtractor    (fetch page → readability parse)
                    ├─ article-like  → clean reading text + hero image
                    └─ visual/design → title + description + hero image (og:image)
   │
   ▼
 clips table (status: pending)  →  fires clip/enrich.requested (Inngest)
   │
   ▼
 AI enrichment worker: summary + auto-tags + category  (all types)
```

### New server modules

- **`apps/server/src/services/detectSourceType.ts`** — pure function mapping a
  URL to `youtube | podcast | tweet | web`. YouTube and podcast detection reuse
  existing URL patterns; tweet = `x.com`/`twitter.com` status URLs; everything
  else = `web`.

- **`apps/server/src/services/extractors/web.ts`** — `extractWebClip(url)`:
  1. Fetch the page (via Decodo residential proxy on datacenter-IP block/403).
  2. Run a Readability algorithm (Mozilla Readability port, e.g.
     `@mozilla/readability` + `linkedom` for a server DOM).
  3. Classify: if Readability yields substantial article text → `kind:
"article"`; else → `kind: "visual"`.
  4. Return `{ kind, title, siteName, faviconUrl, heroImageUrl, excerpt,
content, readingTimeMin }`. `content` is clean markdown/plaintext for
     articles; empty/short for visual.

- **`apps/server/src/services/extractors/tweet.ts`** — `extractTweetClip(url)`:
  1. Parse the tweet ID from the URL.
  2. Primary: Twitter **syndication API**
     `https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<derived>`
     (same source `react-tweet` uses) → rich JSON.
  3. Fallback: FixTweet / vxtwitter public API.
  4. **Self-thread stitching**: if the tweet is part of an author-continuous
     thread, walk the reply chain (same author) and stitch tweets in order.
  5. Return `{ text (stitched), author {name, handle, avatarUrl}, media[],
quotedTweet?, threadTweetIds[], stats, publishedAt }`.

### Enrichment worker (extended, not new)

The existing `clip/embed.requested` Inngest handler is extended into
`clip/enrich.requested`: in addition to the embedding it already produces, it
generates a **summary**, **auto-tags**, and a single top-level **category** for
every clip type via the Claude pipeline. YouTube and podcast summaries continue
to use their existing richer summarization; `web`/`tweet` get a lighter
summary + tags + category pass.

## Data Model

The `clips` table already has the generic columns this needs (`source_type`,
`source_url`, `content`, `author`, `published_at`, `source_metadata`, `tags`,
`summary_json`). One migration extends it.

### Migration `024_universal_clips.sql`

- Extend `source_type` check constraint to include `'web'` (existing:
  `youtube | tweet | podcast`).
- Add columns:
  - `category text` — AI-assigned top-level bucket for the inbox
    (e.g. `idea | reading | design | reference`). Freeform-ish; not a hard enum
    at the DB level (text, nullable) so the AI vocabulary can evolve.
  - `hero_image_url text` — card display image (og:image / tweet media / video
    thumbnail).
  - `excerpt text` — short plaintext preview for the card.

### `source_metadata` (jsonb) — per-type payload, no schema change

- **web**: `{ siteName, faviconUrl, readingTimeMin, kind: "article" | "visual" }`
- **tweet**: `{ handle, avatarUrl, media: [...], quotedTweet?, threadTweetIds?: [...],
likeCount, retweetCount, ... }`

### Content storage

- Article reading text → `content` (clean markdown/plaintext).
- Tweet text or stitched thread → `content`.
- Full raw extractor payload → `source_metadata` (so richer cards can be
  re-rendered later without re-fetching).

### Shared types (`packages/shared`)

- Extend `SourceType` union with `"web"`.
- Add `ClipCategory` type and `WebClipMetadata` / `TweetClipMetadata` interfaces.
- Extend the `Summary`/`Clip` type with `category`, `heroImageUrl`, `excerpt`.

## Capture Surfaces

- **Mobile share intent** (`apps/mobile/app/_layout.tsx`) — today it regex-matches
  YouTube URLs and rejects everything else ("Not a YouTube URL"). Change: accept
  **any URL**, POST to the universal `/api/clips`, let the server detect type.
- **In-app URL paste** — same universal endpoint.
- **Extension / iOS Shortcut** paths that currently target YouTube also widen to
  the universal endpoint.
- Existing YouTube and podcast flows are unchanged — they become branches of the
  one ingest path.

## Display (scoped to this phase — not the #4 redesign)

New types must render decently in the **existing** inbox list:

- **Web clip card** — hero image, title, site name + favicon, excerpt,
  reading-time badge. Tap → reader view (clean article text) for articles, or
  open source link for visual clips.
- **Tweet clip card** — native-style: avatar, name/handle, tweet text, media
  grid. Threads show a "🧵 N tweets" indicator, expandable to the stitched
  thread.
- Both flow into the same unified inbox list. The AI `category` becomes a filter
  chip alongside existing tag filters.

Explicitly "good enough to use," not final polish.

## Error Handling

- **Extractor failure** (page unreachable, tweet deleted, proxy error): save the
  clip with `status: "failed"` + `error_message`, still show it in the inbox as a
  bare link (title = URL) so nothing is silently lost. User can retry.
- **Type misdetection**: `web` is the safe default; a mis-typed clip still saves
  as a generic web clip rather than erroring.
- **Partial tweet thread**: if thread-walking fails partway, save what was
  stitched and note `threadTruncated: true` in metadata.
- **Enrichment failure**: clip is still saved and visible; summary/tags/category
  are best-effort and can be regenerated via the existing retry path.
- **Proxy fallback**: direct fetch first; only route through Decodo on 403/blocked
  to keep proxy usage (and cost) down.

## Testing

- **Unit** (Vitest): `detectSourceType` across a table of URL fixtures;
  Readability classification on saved sample HTML (article vs. visual);
  tweet-ID parsing; syndication JSON → clip mapping; self-thread stitching order.
- **Integration**: universal `/api/clips` routes each detected type to the right
  extractor (extractors mocked); failure path saves a `failed` clip.
- **Smoke** (live, opt-in): fetch a real article, a real tweet, and a real
  self-thread end-to-end.

## Build Sequence

1. Shared types + migration `024_universal_clips.sql`.
2. `detectSourceType` + unit tests.
3. `web` extractor (fetch + Readability + classify) + tests.
4. `tweet` extractor (syndication → FixTweet + thread stitch) + tests.
5. Universal `/api/clips` ingest routing + failure handling.
6. Extend enrichment worker (summary + tags + category for web/tweet).
7. Mobile: widen share intent + URL paste to universal endpoint.
8. Mobile: web clip card + tweet clip card + category filter chip.
9. Smoke tests + docs/devlog + ADR for tweet-fetching approach.

```

```
