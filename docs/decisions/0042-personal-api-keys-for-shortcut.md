---
title: "Personal API keys (cliphy_sk_, sha256-hashed) piggybacking on authMiddleware, for the Apple Shortcut"
date: 2026-06-10
category: Tech
revisit: false
---

## Why this choice

The "Add to Cliphy" Apple Shortcut needs to call `POST /api/queue` without a
Supabase session (Shortcuts can't do the OAuth dance). Options:

- **Personal API keys checked inside the existing `authMiddleware`** (chosen) —
  tokens prefixed `cliphy_sk_` take a hash-lookup path; everything else falls
  through to the Supabase JWT path. Both set the same `userId` context, so
  every existing route, plan limit, and rate limit works unchanged with zero
  per-route changes. This is the industry-standard shape (Stripe/OpenAI-style
  `sk_` keys).
- A separate unauthenticated webhook-ish endpoint with a per-user token — more
  surface area, duplicates queue logic, bypasses shared middleware.
- Native App Intents (no key needed) — requires Swift + EAS native builds;
  deferred (the REST Shortcut covers share sheet, Action Button, back-tap,
  Siri without native code).

## Design

- Key: `cliphy_sk_` + 24 random bytes base64url. **Plaintext shown once**;
  only the sha256 hex lives in `api_keys.key_hash` (unique). `key_prefix`
  (first 14 chars) is stored for display. Max 5 keys/user, revocable.
- `last_used_at` updated fire-and-forget on use.
- `authMethod` ("jwt" | "api_key") added to the Hono context; `/api/keys`
  routes reject `api_key` callers — **an API key cannot mint, list, or revoke
  keys**, so a leaked key is limited to queueing videos and is revocable from
  a real session.
- Shortcut recipe lives in `docs/shortcuts.md`; the published iCloud link goes
  in `SHORTCUT_INSTALL_URL` in `@cliphy/shared` (empty until published —
  clients hide the install button).
