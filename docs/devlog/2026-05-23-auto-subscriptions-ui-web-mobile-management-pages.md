---
day:
date: 2026-05-23
phase: Growth
mood: 🔥 Locked In
hours: 2
tags: [frontend, mobile]
published_to: []
public: false
title: "Auto-subscriptions UI — web + mobile management pages"
---

Built the subscription management UI for both web app and mobile app (CLIP-109).

What got done:

- apps/web/src/pages/Subscriptions.tsx — full management page: list subs with type badge/toggle/delete, add channel/playlist via URL (type inferred from URL pattern), Google connect/disconnect section, pro gate, handles ?google_connected and ?google_error query params from OAuth callback
- apps/mobile/app/(tabs)/subscriptions.tsx — same flow with native Alert dialogs, Switch toggle, WebBrowser for Google OAuth, pull-to-refresh, ActivityIndicator
- Web + mobile api.ts: getSubscriptions, createSubscription, updateSubscription, deleteSubscription, getGoogleStatus, getGoogleConnectUrl, disconnectGoogle
- Nav.tsx: Subscriptions link added; main.tsx: /subscriptions route; mobile \_layout.tsx: Subscriptions tab (repeat-outline icon)

Decision: Changed GET /api/auth/google from c.redirect() to c.json({ url }) so JS clients can call it with a Bearer token and navigate themselves. Browser can't set auth headers on redirects, so returning JSON and letting the client do window.location.href = url is the clean fix. Updated test accordingly.

What to remember: Env vars still needed on Vercel before subscriptions are live: YOUTUBE_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (must point to /api/auth/google/callback), WEB_APP_URL. Also Google Cloud Console needs the callback URL whitelisted.
