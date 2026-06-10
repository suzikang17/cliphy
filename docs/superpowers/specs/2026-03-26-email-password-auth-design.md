---
title: "Email/Password Auth — Design Spec"
date: 2026-03-26
---

# Email/Password Auth — Design Spec

Add email/password authentication as an alternative to Google OAuth in the Chrome extension sidepanel.

## Motivation

Users without Google accounts (or who prefer not to use Google OAuth) cannot currently use Cliphy. Adding email/password auth removes that barrier with minimal complexity — Supabase Auth handles it natively.

## Changes

### `apps/extension/lib/auth.ts`

Add two functions:

- **`signUpWithEmail(email, password)`** — `POST {SUPABASE_URL}/auth/v1/signup` with `{email, password}` body. On success, extracts `access_token` and `refresh_token` from the response JSON and calls `setTokens()`.
- **`signInWithEmail(email, password)`** — `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` with `{email, password}` body. On success, same token extraction and storage.

Both include `apikey: SUPABASE_ANON_KEY` and `Content-Type: application/json` headers. On non-ok responses, throw with a descriptive message parsed from the Supabase error response.

No changes to `signOut`, `refreshAccessToken`, `isTokenExpired`, `getUserIdFromToken`, or `setTokens` — these are already provider-agnostic.

### `apps/extension/entrypoints/sidepanel/App.tsx`

Replace the login screen (currently a single "Sign in with Google" button) with:

1. **Email input** — `type="email"`, required
2. **Password input** — `type="password"`, required, minLength 6 (Supabase default)
3. **Submit button** — "Sign in" or "Sign up" depending on mode
4. **Mode toggle** — text link: "Don't have an account? Sign up" / "Already have an account? Sign in"
5. **Divider** — "or"
6. **Google button** — "Continue with Google" (existing `handleSignIn`, relabeled)

The email auth flow runs directly in the sidepanel (no background script message needed). On success, sends a `SETUP_REALTIME` message to the background script to start the realtime subscription, then calls `init()`.

### `apps/extension/entrypoints/background.ts`

Add a `SETUP_REALTIME` message handler that calls `setupRealtime()`. This lets the sidepanel trigger realtime setup after email auth without duplicating the logic.

### `packages/shared/src/messages.ts`

Add `SETUP_REALTIME` to the `ExtensionMessage` type.

### Supabase Dashboard

- Enable email provider
- Disable "Confirm email" (no email verification required)

## What doesn't change

- Backend auth middleware — validates JWT regardless of provider
- Token storage, refresh, expiry logic in `auth.ts`
- `handle_new_user` DB trigger — auto-creates `users` row on any new auth signup
- Sign-out flow — already provider-agnostic
- Realtime subscription logic — just needs to be triggered after auth

## Error handling

| Scenario                           | User sees                                                    |
| ---------------------------------- | ------------------------------------------------------------ |
| Invalid email format               | Client-side validation (browser native)                      |
| Password too short (<6 chars)      | Client-side validation                                       |
| Wrong email/password (sign in)     | "Invalid email or password"                                  |
| Email already registered (sign up) | "An account with this email already exists. Try signing in." |
| Network error                      | "Something went wrong. Please try again."                    |

## UI layout (login screen)

```
┌──────────────────────────┐
│      [Logo] Cliphy       │
│  YouTube summaries in    │
│       seconds            │
│                          │
│  [feature cards...]      │
│                          │
│  ┌────────────────────┐  │
│  │ Email              │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ Password           │  │
│  └────────────────────┘  │
│  [    Sign in / up    ]  │
│                          │
│  Don't have an account?  │
│  Sign up                 │
│                          │
│  ─────── or ──────────   │
│                          │
│  [ Continue with Google] │
│                          │
│  {error message}         │
└──────────────────────────┘
```

## Out of scope

- Password reset flow (can add later if needed)
- Email confirmation (disabled in Supabase)
- Display name / username field
- Magic link auth
