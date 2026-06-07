# Email-First Auth Flow (Mobile)

**Date:** 2026-06-07
**Status:** Approved design — pending implementation plan
**Scope:** `apps/mobile` (Expo) + a shared `apps/server` endpoint. Web (`apps/web`) is **out of scope** for this iteration.

## Goal

Replace the current single-screen login (email + password + a "Sign in / Sign up" toggle) with a modern **email-first (identifier-first)** flow. The user enters their email first; the app determines what kind of account it is and routes to the right second step:

- **New email** → sign up (password + confirm password)
- **Existing password account** → log in (password)
- **Existing Google-only account** → nudge to "Continue with Google" (no password field)

One entry point does dual duty (login _and_ signup) without the user choosing a mode up front.

## Current state

- `apps/mobile/app/(auth)/login.tsx`: one screen, email + password fields, a `mode` toggle (`signin`/`signup`), and a "Continue with Google" button. Submit calls `signInWithEmail` or `signUpWithEmail`.
- `apps/mobile/lib/auth.ts`: `signInWithEmail` (`signInWithPassword`), `signUpWithEmail` (`signUp`), `signInWithGoogle` (PKCE via `expo-auth-session` + `exchangeCodeForSession`), `signOut`, `getAccessToken`. Redirect URI: `com.cliphy.app://auth/callback`.
- `apps/server`: Hono API using the Supabase **service-role** key (`apps/server/src/lib/supabase.ts`); auth routes in `apps/server/src/routes/auth.ts` and `auth-google.ts`.
- Data today: ~7 Google-identity users, ~2 email/password users. There is **no** password-reset flow.
- Signup currently returns a session immediately (email confirmation is **not** enforced in Supabase). This redesign keeps that behavior; the misleading "Check your email" alert is removed in the new signup branch.

## UX flow

### Screen 1 — Email

- Cliphy logo + tagline.
- Email `TextInput` (`keyboardType="email-address"`, `autoCapitalize="none"`).
- **Continue** button (disabled until a syntactically valid email is entered).
- "— or —" divider.
- **Continue with Google** button (unchanged behavior).

On **Continue**: client-side validate email format → `POST /api/auth/check-email` → branch to Screen 2 based on `status`.

### Screen 2 — Credentials (renders one of three states)

A header shows the entered email with a **← Edit** affordance that returns to Screen 1 (email preserved).

- **`password` (existing password account → Log In):** password field, **Log In** button, **Forgot password?** link.
- **`new` (→ Sign Up):** password field + **confirm password** field, **Create Account** button. Inline error if the two don't match.
- **`google` (Google-only account):** message "This account uses Google sign-in" + a **Continue with Google** button. No password field.

### Navigation model

Implemented as a **single screen with two render states** (a `step` state: `"email" | "credentials"`), not separate router routes — keeps email/status state trivial to share and the "edit email" back-action simple. It still _looks_ like a two-step wizard. (Password reset is a separate route; see below.)

## Backend

### DB function (migration)

`public.email_auth_status(p_email text) returns text`, `SECURITY DEFINER`, reads `auth.users` / `auth.identities`:

- No matching user → `'new'`
- User has an identity with `provider = 'email'` → `'password'` (covers accounts that have _both_ email and Google — password login is valid)
- User exists with only non-email providers (e.g. `google`) → `'google'`

Email comparison is case-insensitive (`lower(email)`). Granted to the service role only.

### Endpoint

`POST /api/auth/check-email` in `apps/server/src/routes/auth.ts`:

- Body `{ email: string }`; validate it's a non-empty, syntactically valid email (return `400` otherwise).
- Calls `supabase.rpc('email_auth_status', { p_email })`.
- Returns `{ status: "new" | "password" | "google" }`.
- **No auth required** (pre-login). **IP rate-limited** (see Security).
- Unit-tested in the existing Vitest suite (`apps/server/src/routes/__tests__/`).

## Mobile

- `lib/api.ts`: `checkEmail(email) → { status }`.
- `lib/auth.ts`: add `resetPassword(email)` (`supabase.auth.resetPasswordForEmail(email, { redirectTo: 'com.cliphy.app://auth/reset' })`) and `updatePassword(newPassword)` (`supabase.auth.updateUser({ password })`). Keep existing helpers; `signUpWithEmail` stays for the `new` branch, `signInWithEmail` for `password`.
- `app/(auth)/login.tsx`: restructure into the two-step screen described above. Keep the existing neobrutalist styling, fonts, and `react-native-safe-area-context` `SafeAreaView` (consistent with the recent migration).

## Forgot password

1. On Screen 2 (`password` branch), **Forgot password?** → calls `resetPassword(email)` → confirmation toast/alert "Check your email for a reset link."
2. Supabase sends an email whose link deep-links into the app: `com.cliphy.app://auth/reset?code=…`.
3. New route `app/(auth)/reset.tsx`: a deep-link handler parses `code` from the incoming URL (via `expo-linking` / expo-router), calls `supabase.auth.exchangeCodeForSession(code)` to establish a recovery session, then shows a **Set new password** form (new password + confirm) → `updatePassword()` → user lands in the app.
4. The root `app/_layout.tsx` auth gate already routes a signed-in session into `(tabs)`, so once the recovery session + password update succeed, normal routing applies.

## Error handling

- Invalid email format (client) → inline message, Continue stays disabled / no request.
- `check-email` network or 5xx failure → **fall back** to a combined email+password screen (current behavior) so users are never blocked from logging in. Log to Sentry.
- Wrong password on Log In → inline error ("Incorrect password").
- Confirm-password mismatch → inline error, submit disabled.
- Rate-limited (`429`) → friendly "Too many attempts, try again in a moment."
- Reset link expired/invalid → message on `reset.tsx` with a path back to login.

## Security

- Email-first inherently allows **user enumeration** — the accepted trade-off for this UX (Google/Slack/Notion do the same).
- Mitigation: **best-effort IP rate-limiting** on `check-email`. Note: the server runs on Vercel serverless, so in-memory limiting is per-instance/best-effort; if stronger guarantees are wanted later, back it with a shared store. Severity is low; this is not a follow-up blocker.
- The DB function is `SECURITY DEFINER` and returns only a coarse enum (`new`/`password`/`google`) — never tokens, IDs, or other PII.

## Testing

- **Server (Vitest):** `check-email` returns correct status for new / password / google / both-identities emails; `400` on malformed email; `429` when rate-limited.
- **Manual (iOS Simulator):** walk all three Screen-2 branches (new signup, password login, Google nudge), the edit-email back action, and the full forgot-password reset round-trip — using the cliclick + screenshot method established this session.

## Out of scope / deferred

- Web app (`apps/web`) email-first redesign — separate task; it can reuse the `check-email` endpoint.
- Stronger (shared-store) rate limiting.
- Enforced email confirmation on signup (current behavior unchanged).

## Open decisions (resolved)

- Google-only email → **nudge to Google** (no password field). ✓
- Layout → **two-step wizard** (single screen, two render states). ✓
- Platform → **mobile only**. ✓
- Forgot password → **included** in this iteration. ✓
- Email-status mechanism → **backend endpoint + `SECURITY DEFINER` DB function** (Approach A). ✓
