# Podcast Feature Design

**Date:** 2026-07-18
**Status:** Draft

---

## Summary

Podcast subscription and auto-queue feature. Users subscribe to RSS feeds; new episodes are auto-queued or staged for manual approval per feed settings. Episodes are transcribed via self-hosted Whisper on VPS and summarized via the existing Claude pipeline, landing in the Queue tab alongside YouTube summaries.

---

## Architecture

Three layers:

1. **VPS Whisper service** (`services/whisper/`) — FastAPI wrapping faster-whisper small model, CPU-only, accepts audio URL, returns transcript
2. **Server** (Hono/Vercel + Inngest) — `podcast_feeds` + `podcast_episodes` tables, REST endpoints, Inngest cron polling + transcription workers
3. **Mobile** — new Podcasts tab (feed management, episode list, settings modal)

---

## Data Model

### `podcast_feeds`

| Column                 | Type        | Notes          |
| ---------------------- | ----------- | -------------- |
| `id`                   | uuid        | PK             |
| `user_id`              | uuid        | FK → users     |
| `rss_url`              | text        |                |
| `title`                | text        |                |
| `author`               | text        |                |
| `artwork_url`          | text        | nullable       |
| `auto_queue`           | bool        | default `true` |
| `min_duration_seconds` | int         | nullable       |
| `max_duration_seconds` | int         | nullable       |
| `last_polled_at`       | timestamptz | nullable       |
| `created_at`           | timestamptz |                |

### `podcast_episodes`

| Column             | Type        | Notes                                                                 |
| ------------------ | ----------- | --------------------------------------------------------------------- |
| `id`               | uuid        | PK                                                                    |
| `feed_id`          | uuid        | FK → podcast_feeds                                                    |
| `user_id`          | uuid        | FK → users                                                            |
| `guid`             | text        | RSS item guid, dedup key                                              |
| `title`            | text        |                                                                       |
| `description`      | text        | nullable                                                              |
| `audio_url`        | text        |                                                                       |
| `artwork_url`      | text        | nullable                                                              |
| `duration_seconds` | int         | nullable                                                              |
| `published_at`     | timestamptz |                                                                       |
| `status`           | enum        | `pending_approval` \| `queued` \| `processing` \| `done` \| `skipped` |
| `clip_id`          | uuid        | nullable, FK → clips.id                                               |
| `created_at`       | timestamptz |                                                                       |

---

## API Endpoints

| Method   | Path                               | Description                        |
| -------- | ---------------------------------- | ---------------------------------- |
| `POST`   | `/api/podcasts/feeds`              | Subscribe to a feed                |
| `GET`    | `/api/podcasts/feeds`              | List subscribed feeds              |
| `PATCH`  | `/api/podcasts/feeds/:id`          | Update feed settings               |
| `DELETE` | `/api/podcasts/feeds/:id`          | Unsubscribe                        |
| `GET`    | `/api/podcasts/feeds/:id/episodes` | Paginated episode list             |
| `POST`   | `/api/podcasts/feeds/:id/refresh`  | Manual poll                        |
| `POST`   | `/api/podcasts/episodes/:id/queue` | Approve episode (pending → queued) |
| `POST`   | `/api/podcasts/episodes/:id/skip`  | Skip episode                       |
| `POST`   | `/api/podcasts/import/opml`        | Bulk import via OPML file          |

---

## Transcript Pipeline

1. Check `<podcast:transcript>` tag in RSS episode item — fetch if present (free, no Whisper needed)
2. Fall back to VPS Whisper service (HTTP call from Inngest worker): POST audio URL, receive transcript
3. Pass transcript to existing Claude summarization pipeline (same path as YouTube transcripts)

---

## VPS Whisper Service

- Location: `services/whisper/`
- Runtime: FastAPI, faster-whisper small model, CPU-only
- Interface: accepts `audio_url`, streams or returns full transcript text
- Deployment: self-hosted on VPS, called over internal HTTP from Inngest workers

---

## Mobile UI

### Podcasts Tab

- Feed list with artwork, title, author
- Add-by-URL flow (paste RSS URL → preview → subscribe)
- OPML import placeholder (bulk subscribe)

### Episode List Screen

- Per-feed view, filterable by status (`pending_approval`, `queued`, `done`, `skipped`)
- Episode row: artwork, title, duration, published date, status badge
- Actions: Queue / Skip on `pending_approval` episodes

### FeedSettingsModal

- `auto_queue` toggle
- Min duration filter (skip episodes shorter than N minutes)
- Max duration filter (skip episodes longer than N minutes)

### Design Language

- Neobrutalist, matching existing app
- `border-2 border-black`, `brutalShadow` utility
- Consistent with Queue tab card style

---

## Open Questions

- Polling frequency for Inngest cron (hourly? per-feed configurable?)
- Whisper model size trade-off: small (fast/cheap) vs. medium (accuracy) — start with small
- Audio file size limits and timeout handling for long episodes (2h+)
- Whether to store transcripts in Supabase or keep ephemeral
