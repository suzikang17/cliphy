# Clips Generalization & Web Share Target

**Date:** 2026-06-29
**Status:** Approved

## Overview

Expand Cliphy from a YouTube-only summarizer into a multi-source clip hub. Phase 1: generalize the `summaries` data model into a universal `clips` model, add a Web Share Target for mobile saves, and build an embedding pipeline so every saved clip is vectorized for future topic clustering and cross-content connections.

## Goals

- Users can save any content to Cliphy from the iOS/Android share sheet
- Tweets (and eventually articles, podcasts, etc.) are stored alongside YouTube summaries in one unified model
- Every clip gets a vector embedding on save, ready for semantic search and clustering later
- YouTube behavior is fully preserved

## Out of Scope (this phase)

- Extension button on x.com (next phase)
- Topic clustering / connections UI
- Content generation features
- Summarization of tweets

---

## Data Model

### `clips` table (renamed from `summaries`)

New universal columns added to the existing table:

| Column | Type | Notes |
|---|---|---|
| `source_type` | `enum('youtube','tweet')` | Default `'youtube'` for existing rows |
| `source_url` | `text` | Canonical URL of the clip |
| `content` | `text` | Tweet text; YT transcript (already stored implicitly) |
| `author` | `text` | @handle for tweets; channel name for YT |
| `published_at` | `timestamptz` | When original content was posted |
| `embedding` | `vector(N)` | Dimension TBD when embedding provider chosen |
| `source_metadata` | `jsonb` | Type-specific extras (see below) |

Existing YT-specific columns (`video_duration_seconds`, `video_channel`) are preserved as-is for backwards compat; `author` mirrors `video_channel` for YT rows.

**Tweet row:**
```json
{
  "source_type": "tweet",
  "source_url": "https://x.com/user/status/123",
  "content": "tweet text here",
  "author": "@handle",
  "published_at": "2026-06-29T10:00:00Z",
  "summary_json": null,
  "status": "completed",
  "source_metadata": {
    "display_name": "Full Name",
    "avatar_url": "...",
    "images": ["..."],
    "quoted_tweet": { "text": "...", "author": "..." }
  }
}
```

**YouTube row:** unchanged except `source_type: 'youtube'` backfilled, `source_url` populated from `video_url`.

---

## Web Share Target

Register `cliphy.app` as a PWA Web Share Target so "Save to Cliphy" appears in the iOS/Android share sheet from any app.

**Manifest addition (`manifest.json`):**
```json
"share_target": {
  "action": "/save",
  "method": "GET",
  "params": {
    "title": "title",
    "text": "text",
    "url": "url"
  }
}
```

**`/save` route (web app):**
- Receives `?url=&text=&title=` from the OS share sheet
- Detects `source_type` from the URL (x.com/twitter.com → `tweet`; youtube.com → `youtube`; else `article`)
- For tweets: uses `text` param as content, parses author from URL
- Shows a minimal "Saved to Cliphy" confirmation UI
- Authenticated users: saves immediately; unauthenticated: prompts login then saves

---

## API

### `POST /api/clips` (new unified endpoint)

Replaces `/api/queue` for non-YouTube content. YouTube queuing continues to use `/api/queue` internally but the endpoint is unified going forward.

**Request:**
```json
{
  "source_type": "tweet",
  "source_url": "https://x.com/user/status/123",
  "content": "tweet text",
  "author": "@handle",
  "published_at": "2026-06-29T10:00:00Z",
  "title": null,
  "source_metadata": { ... }
}
```

**Response:** `{ "id": "...", "status": "completed" }`

For `source_type: 'youtube'`, delegates to existing summarize pipeline and returns `status: 'pending'`.

---

## Embedding Pipeline

New Inngest function `embed-clip` runs after every clip save:

```
clip saved → POST /api/clips → insert row (status: completed for tweets)
                              → trigger embed-clip(clipId)

embed-clip → fetch clip by id
           → build embed_text:
               tweet: "@handle: {content}"
               youtube: "{summary} {keyPoints joined}"
           → call embeddings API
           → UPDATE clips SET embedding = [...] WHERE id = clipId
```

For YouTube: `embed-clip` is chained at the end of `summarize-video` (fires once summary is complete, not on queue). For tweets: fires immediately on save.

Embedding provider and vector dimension TBD at implementation time.

---

## Migration Plan

1. Add new columns to `summaries` table via Supabase migration (all nullable, no downtime)
2. Backfill existing rows: `source_type = 'youtube'`, `source_url = video_url`, `author = video_channel`
3. Rename table `summaries → clips` in a single migration
4. Update all server code: routes, services, types, Inngest functions
5. Update shared types: rename `Summary` → `Clip`, add new fields
6. Update extension + web app references
7. Deploy — no breaking change to users

---

## Success Criteria

- User on iPhone can share a tweet from Twitter/X app → "Save to Cliphy" appears → clip stored in DB
- Saved tweet appears in the user's clip list in the web app
- `embedding` column is populated within seconds of save
- All existing YouTube summaries continue to work without regression
- Vector dimension consistent across all rows (no mixed dimensions)
