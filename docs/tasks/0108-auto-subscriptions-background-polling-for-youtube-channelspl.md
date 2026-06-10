---
title: "Auto-subscriptions — background polling for YouTube channels/playlists"
status: done
owner: none
type: feature
completed: 2026-05-23
---

# Auto-subscriptions — background polling for YouTube channels/playlists

Completed May 23. DB migration (4 tables), YouTube service (RSS+API), subscription CRUD, Google OAuth, Inngest cron fan-out, billing downgrade handler. 55 tests. Env vars still needed on Vercel: YOUTUBE_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, WEB_APP_URL. Web/mobile UI not built yet.

_Migrated from task-archive.md (CLIP-108, target —)._
