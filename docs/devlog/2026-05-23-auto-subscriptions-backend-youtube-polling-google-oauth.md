---
day:
date: 2026-05-23
phase: Growth
mood: 🔥 Locked In
hours: 4
tags: [backend, infra]
published_to: []
public: false
title: "Auto-subscriptions backend — YouTube polling + Google OAuth"
---

TL;DR: Built the full auto-subscriptions backend. Subscribe once, server polls every 15 min and auto-queues new videos for summary. Pro-only. 9 tasks, all server-side, no UI yet.

What got done

- DB migration: subscriptions, subscription_seen_videos, user_google_tokens, oauth_states
- Shared types: Subscription, SubscriptionType, GoogleConnectionStatus + constants in @cliphy/shared
- YouTube service: fetchChannelVideos via RSS (free), fetchPlaylistVideos via Data API, Watch Later via OAuth
- Subscription CRUD: GET/POST/PATCH/DELETE /api/subscriptions (requirePro gate)
- Google OAuth: /api/auth/google (initiate + callback + status + disconnect)
- Inngest: cron every 15 min fans out one event per active subscription, worker processes each independently
- Billing webhook: pause all subscriptions when Stripe downgrades user to free
- 55 new tests across all new files

Decisions

- YouTube RSS for channels (free, no quota) vs Data API for playlists — best of both
- Inngest fan-out: cron fires events, isolated workers retry independently per subscription
- Seen-video snapshot at creation time — prevents backfilling old videos on first poll

What to remember

- Inngest v4: createFunction takes 2 args, triggers go inside config object as triggers: [{cron}] or [{event}]
- Env vars needed on Vercel: YOUTUBE_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, WEB_APP_URL
- Web/mobile UI not built — backend is feature complete but users can't configure subscriptions without UI
