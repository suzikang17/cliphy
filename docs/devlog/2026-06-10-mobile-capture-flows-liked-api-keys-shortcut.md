---
title: "Day 65 — Mobile capture flows: liked-videos auto-queue, save-to-playlist, API keys + Apple Shortcut"
date: 2026-06-10
day: 65
phase: Growth
---

## Session summary

The iOS share extension has too much friction to be the only mobile capture
path. Designed and shipped three lower-friction ways to queue a video from a
phone, all riding on the existing auto-subscriptions infra: **liked-videos
auto-queue** (like in YouTube → queued), a **"Save to Cliphy playlist"
capture flow** (Save → playlist in YouTube → queued; private playlists now
work), and **personal API keys powering an "Add to Cliphy" Apple Shortcut**
(share sheet / Action Button / Siri, no native code). Clipboard onboarding
copy now leads with copy-link-and-open. Spec + plan in
`docs/superpowers/{specs,plans}/`. Prod migrations applied (`liked` enum
value, `api_keys` table). Manual prod verification is the remaining task
(CLIP-112/113); widget/Control Center deferred (CLIP-114).

## What got done

- **Liked-videos subscription** (`type: 'liked'`): `fetchLikedVideos` via
  `videos.list?myRating=like` with user OAuth; polling, POST route, Google
  disconnect handling; enable buttons on mobile + web subscriptions screens.
- **Playlist polls use the user's Google token when connected** (fallback:
  public API key) — private "Cliphy" playlists now pollable.
- **"Queue from inside YouTube" capture card** on the mobile subscriptions tab
  (3-step setup, shown until a playlist subscription exists).
- **Personal API keys**: `api_keys` table (sha256 hash, prefix display, RLS),
  `cliphy_sk_` path in `authMiddleware` (with `authMethod` context),
  `/api/keys` CRUD (JWT-only, max 5), mobile key-generation card + API client.
- **Apple Shortcut recipe** in `docs/shortcuts.md`; `SHORTCUT_INSTALL_URL`
  constant (empty until the iCloud link is published).
- **Clipboard onboarding**: queue empty state now leads with the copy-link path.
- Tests: youtube service (liked mapping), subscriptions route (liked create /
  no-Google 403), auth middleware (key auth, hash lookup, JWT fallthrough),
  api-keys routes (create/cap/403/delete). All green.

## Part 2 (same day): onboarding import + playlist auto-discovery

- **Import recent likes on enable**: `POST /subscriptions` accepts
  `importCount` (liked-only, 0–50). The N most recent likes are left out of
  the seen-snapshot and an immediate poll is dispatched, so they queue through
  the normal limit logic. Mobile prompts "Just new likes / Import 10 recent";
  web uses a confirm dialog.
- **Cliphy-playlist auto-discovery**: any of the user's own playlists with
  "cliphy" in the title (case-insensitive, via `playlists.list?mine=true`)
  auto-subscribes — triggered on Google connect and every 15-min poll cycle
  (`subscription/discover.requested` Inngest event). Pro-gated, respects the
  20-subscription cap, snapshot-on-create keeps it forward-only. Configurable
  via `user_settings.auto_discover_playlists` (default **on**; toggle in the
  mobile Google card). Migration 018 applied to prod.
- Capture-card copy now says "name a playlist Cliphy and we'll find it" when
  Google is connected — no link pasting needed.

## Part 3 (same day): mobile deep-link for Google OAuth

- The connect flow now carries a `platform` (web | mobile | extension, stored
  on `oauth_states`, migration 019). Mobile initiates with `?platform=mobile`
  and uses `WebBrowser.openAuthSessionAsync` with the
  `com.cliphy.app://subscriptions` return URL — the server callback 302s to
  the deep link (success **and** error paths), and the in-app browser closes
  itself instead of stranding the user on the web subscriptions page.
- `extension` is accepted and reserved: the extension only uses Google for
  Supabase _sign-in_ today (separate `browser.identity` flow); if it ever gets
  a subscriptions panel it would use `launchWebAuthFlow`, since Chrome can't
  receive server redirects to `chrome-extension://`. Until then it falls back
  to the web app redirect, same as web.
- Note: CLIP-81 (Supabase sign-in OAuth stuck on empty page in mobile) is the
  _other_ OAuth flow and still open — same fix shape (auth session + deep
  link) applies.

## Decisions

- ADR 0041 — liked videos via `myRating=like`, not the `LL` playlist; Watch
  Later presumed dead (2016 API deprecation) pending smoke test.
- ADR 0042 — Stripe-style `cliphy_sk_` keys hashed at rest, checked inside
  `authMiddleware`; API keys can't manage API keys.

## Issues

- YouTube's API has **no watch-history access at all** (removed 2016) — the
  "recently watched" capture idea is impossible; liked videos is the closest
  workable gesture.
- Watch Later (`WL`) very likely returns empty via the API too, despite our
  shipped `watch_later` type — never exercised in prod (0 Google connections).
  Verify then remove the UI option (CLIP-112).
- A parallel session was committing to main during this work (admin set-count
  removal, lore/Atlas); two transient test-interference runs, no real
  conflicts. Admin `set-count` tests were failing pre-existing — that session
  resolved them by removing the control.

## What to remember

- The Shortcut install button stays hidden until `SHORTCUT_INSTALL_URL` in
  `packages/shared/src/constants.ts` gets the published iCloud link
  (build recipe: `docs/shortcuts.md`).
- API keys are full-privilege except key management — treat like passwords;
  plaintext is shown exactly once at creation.
- Liked/playlist polling latency is the 15-min Inngest cron — set that
  expectation in any new capture copy.

---

## Commits

- `add mobile capture flows design spec` / `add mobile capture flows implementation plan`
- `add liked subscription type to shared types`
- `add liked value to subscription_type enum` (migration 016, applied to prod)
- `add fetchLikedVideos to youtube service`
- `poll liked-videos subscriptions; use OAuth token for playlist polls`
- `accept liked subscriptions in POST /subscriptions`
- `deactivate liked subscriptions on google disconnect`
- `mobile: liked-videos subscription UI + save-to-playlist capture card`
- `web: liked-videos subscription UI`
- `add api_keys table` (migration 017, applied to prod)
- `support personal api keys in auth middleware`
- `add personal api key routes`
- `add apple shortcut recipe doc`
- `mobile: shortcut key setup card + api-key client`

## Tomorrow's plan

- CLIP-112: deploy, connect Google in prod, verify liked-videos end-to-end,
  WL smoke test (remove the option if empty), private-playlist capture test.
- CLIP-113: build the Shortcut in the Shortcuts app, publish the iCloud link,
  fill `SHORTCUT_INSTALL_URL`, rebuild mobile, test from share sheet + Action
  Button.
