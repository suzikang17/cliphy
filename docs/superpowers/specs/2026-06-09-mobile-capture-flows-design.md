---
title: "Mobile Capture Flows Design"
date: 2026-06-09
---

# Mobile Capture Flows Design

**Date:** 2026-06-09
**Status:** Approved

## Overview

The iOS share extension has high friction (share sheet burial, app cold-launch) and is expected to cause user dropoff. This design adds four lower-friction ways to get a video into the Cliphy queue from a phone, leaning on the existing auto-subscriptions infrastructure (Inngest polling cron, `subscriptions` / `subscription_seen_videos` tables, Google OAuth) wherever possible. The share extension stays as-is.

Workstreams, in build order:

1. **Liked-videos subscription** — like a video in YouTube → it gets queued
2. **Watch Later verification** — smoke-test the existing `watch_later` type; remove if dead
3. **"Save to Cliphy playlist" capture flow** — Save → playlist inside YouTube → it gets queued (UX only; polling already works)
4. **Personal API keys + Apple Shortcut** — "Add to Cliphy" shortcut in share sheet / Action Button / Siri, hitting the REST API
5. **Clipboard onboarding copy** — teach the existing copy-link→open-app banner flow
6. **Interactive widget / Control Center control** — native WidgetKit "Add from clipboard" (deferred, own session)

## 1. Liked-videos subscription

New subscription type `liked`. Polling calls `GET https://www.googleapis.com/youtube/v3/videos?part=snippet&myRating=like&maxResults=50` with the user's OAuth token (scope `youtube.readonly`, already requested). Unlike Watch Later, `myRating=like` is a documented, working endpoint.

**Server:**

- Migration `016_liked_subscriptions.sql`: `ALTER TYPE public.subscription_type ADD VALUE 'liked';`
- `services/youtube.ts`: add `fetchLikedVideos(accessToken)` returning `YouTubeVideoPreview[]` (note: `publishedAt` is the video's publish date, not the like date — irrelevant, dedup is by seen-video snapshot)
- `services/subscriptions.ts` (`pollAndQueueSubscription`): `liked` requires a Google token, same deactivate-on-refresh-failure handling as `watch_later`
- `routes/subscriptions.ts` (POST): accept `type: "liked"` with no `sourceUrl`; requires connected Google account (same 403 `google_not_connected` flow); insert with `source_id: "LIKED"`, `source_name: "Liked Videos"`; snapshot current likes on create so only _future_ likes get queued
- `routes/auth-google.ts` (DELETE): deactivate `liked` subscriptions too, not just `watch_later`

**Shared:** add `"liked"` to `SubscriptionType` and `SUBSCRIPTION_TYPES`.

**Clients (mobile + web):** in the Google section of the subscriptions screen, add an "Auto-queue Liked Videos" enable button alongside Watch Later (same connected-Google gate), plus badge label/colors for the new type.

## 2. Watch Later verification

Google deprecated API access to the `WL` playlist in September 2016 — `playlistItems.list` returns an empty list even for the owner with OAuth. The shipped `watch_later` type has never been used in prod (0 subscriptions, 0 connected Google accounts), so it's unverified.

**Action:** after the Google connect flow is exercised (during liked-videos testing), poll `WL` once with a real token. If it returns empty (expected): remove the Watch Later enable buttons from mobile/web UI and the `watch_later` branch from the POST route, keep the enum value and polling branch for tolerance, and log an ADR. If it surprisingly works, leave everything and update the auto-subscriptions design doc.

## 3. "Save to Cliphy playlist" capture flow

Lowest-friction capture: the user never leaves YouTube. One-time setup: create a playlist named "Cliphy" (unlisted) in YouTube, paste its link into Cliphy once. From then on, _Save → Cliphy_ (2 taps in the YouTube app) queues the video within one poll cycle (15 min).

This is pure UX on top of existing playlist polling:

- **Mobile:** a "Queue from inside YouTube" setup card on the subscriptions tab with the 3-step instructions and the existing paste-URL input. Shown prominently when the user has no playlist subscription.
- **Private playlist support (small server change):** `pollAndQueueSubscription` and the POST route currently fetch playlists with the public API key only. If the user has a connected Google token, pass it for `playlist` fetches too (fall back to API key). This lets the Cliphy playlist be **private** instead of unlisted.
- Copy notes the ~15-minute polling latency.

## 4. Personal API keys + Apple Shortcut

A pre-built iCloud Shortcut "Add to Cliphy" that POSTs the shared URL (share-sheet input, else clipboard) to the queue endpoint. Shortcuts appear near the top of the share sheet, can be bound to the Action Button, back-tap, and Siri — no native code.

**API keys (server):**

- Migration `017_api_keys.sql`:

```sql
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  key_hash     text not null unique,   -- sha256 hex of the full key
  key_prefix   text not null,          -- first 12 chars, for display
  name         text not null default 'Shortcut',
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
```

RLS: select own. Max 5 keys per user.

- Key format: `cliphy_sk_<32 url-safe random chars>`. Plaintext returned once at creation; only the hash is stored.
- `middleware/auth.ts`: if the Bearer token starts with `cliphy_sk_`, sha256 it and look up `api_keys` (update `last_used_at`, fire-and-forget); otherwise fall through to the existing Supabase JWT path. Same `userId` context either way, so all existing routes/limits work unchanged.
- `routes/api-keys.ts`: `POST /api/keys` (create, returns plaintext once), `GET /api/keys` (list prefix/name/lastUsedAt), `DELETE /api/keys/:id`. JWT-auth only — an API key cannot mint or list keys.

**Shortcut + setup UX:**

- The shortcut recipe: receive URL from share sheet (fallback: clipboard) → `Get Contents of URL` POST to the queue endpoint with `Authorization: Bearer <key>` and `{"videoUrl": ...}` → show notification with result. Suki builds it once in the Shortcuts app with an `Import Question` for the API key, publishes the iCloud link; the link lives in `@cliphy/shared` constants.
- **Mobile:** "Set up the Shortcut" card on the subscriptions (or settings) screen: generate key → copy → open shortcut install link. Recipe documented in `docs/shortcuts.md` so it can be rebuilt.

**Security:** keys hashed at rest, prefix-only display, revocable, capped at 5. Free-tier monthly limits already enforced by the queue route.

## 5. Clipboard onboarding copy

The app-focus clipboard banner already exists (`apps/mobile/app/(tabs)/index.tsx`). Update onboarding/empty-state copy to teach "copy a YouTube link, open Cliphy" as the quick path. Folded into whichever PR touches the home screen copy.

## 6. Widget / Control Center (deferred)

iOS 17 interactive widget + iOS 18 Control Center control with an "Add from clipboard" button. Requires `expo-apple-targets`, Swift/WidgetKit, an App Intent, EAS build changes, and on-device testing — and the Shortcut covers most of the same use case via the Action Button. Deferred to its own spec/session after 1–5 ship and prove out.

## Error handling

- Liked/playlist polls: existing behavior — failures logged, seen-snapshot prevents retry spam, token refresh failure deactivates the subscription.
- API-key auth: invalid/revoked key → 401, same shape as JWT failure. Queue limit errors surface in the Shortcut's result notification (the queue route already returns 4xx with messages).

## Testing

- Unit (Vitest): API-key middleware (valid key, revoked key, JWT fallthrough), key create/list/delete routes, `liked` POST validation (no Google → 403, duplicate → 409), `fetchLikedVideos` response mapping.
- Manual: connect Google in prod, verify liked-videos poll queues a freshly-liked video; WL smoke test (workstream 2); install Shortcut on-device and run from share sheet + Action Button; playlist capture end-to-end with a private playlist.
