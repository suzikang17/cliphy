---
title: YouTube Data API v3
category: Data
status: Active
plan: "Free"
monthly_cost: 0
---

# YouTube Data API v3

## Why

Powers auto-subscriptions: liked-videos polling (`videos.list?myRating=like`), playlist polling (`playlistItems.list`), playlist auto-discovery (`playlists.list?mine=true`), and channel/playlist name resolution. Channel subscriptions use the free RSS feed instead (zero quota). Per-user reads authenticate with the user's Google OAuth token (`youtube.readonly` scope); public reads use the server API key.

## Cost notes

$0 — quota-limited, not billed. 10,000 units/day default; every read we make costs 1 unit.

Burn per Google-connected user (15-min cron): liked poll 96/day + per-playlist 96/day + hourly discovery 24/day ≈ **~220 units/day** → ceiling of roughly **40 fully-loaded connected users** on the default quota.

Mitigations already in place: dormant users (>14 days inactive via `users.last_active_at`) back off to one poll/day; discovery runs hourly, not per cycle; app-open refresh is throttled to 2 min per subscription. Next levers if the ceiling nears: lengthen the dormancy window's cron share, then request a quota increase (free form, needs the verified OAuth consent screen).

**Watch:** quota usage at [console.cloud.google.com → APIs & Services → YouTube Data API v3 → Quotas](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas). Alert-worthy at >7,000 units/day.
