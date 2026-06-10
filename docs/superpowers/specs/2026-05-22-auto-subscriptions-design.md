---
title: "Auto-Subscriptions Design"
date: 2026-05-22
---

# Auto-Subscriptions Design

**Date:** 2026-05-22  
**Status:** Approved

## Overview

Auto-subscriptions let users subscribe to YouTube channels, public playlists, or their Watch Later list. The server polls for new videos on a schedule and automatically queues them for summarization — no action required after initial setup. Available on web app and mobile (Pro-only).

## Sources

| Source                        | Polling method                                      | Auth                        |
| ----------------------------- | --------------------------------------------------- | --------------------------- |
| Channel                       | YouTube RSS feed (`/feeds/videos.xml?channel_id=…`) | None                        |
| Public playlist               | YouTube Data API v3 `playlistItems.list`            | Server API key              |
| Watch Later (`playlistId=WL`) | YouTube Data API v3 `playlistItems.list`            | Per-user Google OAuth token |

"Recently Watched" is excluded: YouTube removed watch history from the public API in 2016 and there is no server-side workaround.

## Architecture

Three layers:

1. **Data model** — `subscriptions`, `subscription_seen_videos`, `user_google_tokens` tables
2. **Polling** — Inngest cron (every 15 min) fans out one event per active subscription; each handler polls YouTube and enqueues new videos using the existing queue logic
3. **API** — 5 CRUD routes for subscriptions + 3 routes for Google OAuth connect/disconnect

## Data Model

### `subscriptions`

```sql
id               uuid PK
user_id          uuid FK → users
type             enum('channel', 'playlist', 'watch_later')
source_id        text          -- YouTube channel ID or playlist ID; null for watch_later
source_name      text          -- display name resolved at creation time
source_url       text          -- original URL the user pasted
is_active        boolean NOT NULL DEFAULT true
last_checked_at  timestamptz
skipped_count    integer NOT NULL DEFAULT 0
last_skipped_at  timestamptz
created_at       timestamptz
updated_at       timestamptz
```

### `subscription_seen_videos`

```sql
subscription_id  uuid FK → subscriptions
youtube_video_id text
seen_at          timestamptz DEFAULT now()
PRIMARY KEY (subscription_id, youtube_video_id)
```

At subscription creation we snapshot the current video list into this table — so only videos added _after_ setup get queued (no backlog flood).

### `user_google_tokens`

```sql
user_id      uuid PK FK → users
access_token  text NOT NULL
refresh_token text NOT NULL
expires_at    timestamptz NOT NULL
scopes        text NOT NULL
created_at    timestamptz
updated_at    timestamptz
```

Used exclusively for Watch Later polling. Tokens are refreshed automatically before each poll if expired.

## Polling Flow

```
[Inngest cron: every 15 min]
  → fetch all active subscriptions
  → send "subscription/poll.requested" event per subscription

[subscription/poll.process handler]
  → fetch recent videos from YouTube:
      channel      → parse RSS feed (free, no API key)
      playlist     → playlistItems.list (server API key)
      watch_later  → playlistItems.list (user OAuth token, auto-refresh if expired)
  → for each returned video:
      if youtube_video_id in subscription_seen_videos → skip
      insert into subscription_seen_videos
      if user monthly limit reached:
        increment skipped_count, set last_skipped_at on subscription
        stop processing further videos this run
      else:
        call internal queue add logic (same path as POST /api/queue)
        respects duplicate check and rate limit decrement/rollback
```

The fan-out pattern keeps each handler small and independently retryable (Inngest retries on failure without re-processing other subscriptions).

## API Routes

### Subscriptions (all behind `authMiddleware` + `requirePro("auto_subscribe")` except GET)

```
GET    /api/subscriptions              list user's subscriptions
POST   /api/subscriptions              create subscription
PATCH  /api/subscriptions/:id          update (pause/resume via is_active)
DELETE /api/subscriptions/:id          delete subscription + seen_videos
```

`POST /api/subscriptions` body:

```json
{
  "type": "channel" | "playlist" | "watch_later",
  "sourceUrl": "https://youtube.com/@handle"  // omit for watch_later
}
```

Server resolves channel handles (`@name`) to channel IDs via `channels.list?forHandle=`. Validates the URL, fetches source metadata (name, ID), creates the subscription, and snapshots existing videos as seen.

### Google OAuth

```
GET    /api/auth/google                initiate OAuth → redirect to Google
GET    /api/auth/google/callback       exchange code, store tokens, redirect to app
DELETE /api/auth/google                revoke + delete stored tokens
```

Required Google OAuth scope: `https://www.googleapis.com/auth/youtube.readonly`

OAuth callback redirects to the web app / mobile deep link after storing tokens. Watch Later subscriptions require a connected Google account; attempting to create one without tokens returns 403 with `code: "google_not_connected"`.

## Rate Limit Behavior

When auto-queuing would exceed the user's monthly summary limit:

- The video is **not** queued
- `skipped_count` is incremented and `last_skipped_at` is set on the subscription row
- The frontend displays a warning badge on that subscription: "N videos skipped — monthly limit reached"
- All further videos in the same poll run are also skipped (stop early)

Skipped count resets when the user's monthly count resets (handled by the same `monthly_count_reset_at` mechanism already in place).

## Pro Gating

```ts
PRO_FEATURES.AUTO_SUBSCRIBE = "auto_subscribe";
```

- `POST /api/subscriptions` is behind `requirePro("auto_subscribe")`
- `GET /api/subscriptions` is available to all authenticated users (so existing data is visible after downgrade)
- On downgrade: existing subscriptions are paused (`is_active = false`); they resume if the user re-upgrades

## Error Handling

| Scenario                                  | Behavior                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| RSS feed unavailable                      | Inngest retries (up to 3x); `last_checked_at` not updated                            |
| YouTube API quota exceeded                | NonRetriableError logged to Sentry; subscription skipped this run                    |
| OAuth token refresh fails                 | Subscription `is_active` set to false; user notified via `last_skipped_at` mechanism |
| Video transcript unavailable              | Same as manual queue — summary enters `failed` state                                 |
| Duplicate video (already in user's queue) | Silent skip (existing duplicate check in queue logic)                                |

## New Constants

```ts
PRO_FEATURES.AUTO_SUBSCRIBE = "auto_subscribe";

SUBSCRIPTION_TYPES = {
  CHANNEL: "channel",
  PLAYLIST: "playlist",
  WATCH_LATER: "watch_later",
} as const;

MAX_SUBSCRIPTIONS_PER_USER = 20; // Pro limit, enforced on POST
```

## New Shared Types

```ts
export type SubscriptionType = "channel" | "playlist" | "watch_later";

export interface Subscription {
  id: string;
  userId: string;
  type: SubscriptionType;
  sourceId?: string;
  sourceName: string;
  sourceUrl?: string;
  isActive: boolean;
  lastCheckedAt?: string;
  skippedCount: number;
  lastSkippedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

## Out of Scope (v1)

- Per-subscription filters (min duration, keyword in title)
- Recently Watched (YouTube API limitation)
- Auto-import YouTube channel subscriptions
- Notification emails/push when new videos are queued
- Subscription analytics (how many videos queued per subscription)
