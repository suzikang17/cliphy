---
day: 11
date: 2026-03-02
phase: Launch Prep
mood: 😤 Grinding
hours:
tags: [auth, bug, backend, frontend, UI]
published_to: []
public: false
title: "Day 11 — Auth Bug Fixes, Error UX, UI Polish, Dark Mode & Stripe Billing"
---

**TL;DR:** Fixed 5 auth bugs from manual testing audit, fixed a sneaky "User not found" root cause (stale column names), replaced raw errors with friendly user-facing messages. Then did a UI polish pass — DM Sans font, sticky nav bar, ad-proof video duration, and lowered free tier to 5/mo.

## What got done

- Fixed 5 auth bugs discovered during manual testing audit:
  - `await isAuthenticated()` in background.ts (was evaluating Promise as truthy)
  - Server-side token revocation on sign-out (`/auth/v1/logout`)
  - Deduplicate concurrent refresh calls (module-level promise singleton)
  - `AuthError` class — only sign out on 401, not network/server errors
  - Proactive token expiry check with 30s buffer before API requests
- Fixed root cause of "User not found" — `/me` endpoint selecting renamed `daily_*` columns (now `monthly_*` from migration 005)
- Replaced raw error messages with friendly user-facing text, raw errors logged to console
- Improved sign-in cancel UX
- **UI polish pass:**
  - Switched to DM Sans font (bundled via `@fontsource-variable/dm-sans`)
  - Added sticky top bar with back navigation across all sidepanel views
  - Fixed video duration showing ad length — now reads from `meta[itemprop=duration]` instead of `.ytp-time-duration`
  - Bigger thumbnails on summaries page (`mqdefault.jpg`, `w-44`)
  - Stacked UsageBar vertically for narrow sidepanel widths
- Lowered free tier limit from 10 → 5 summaries/month
- Upgrade buttons now use Stripe Checkout flow instead of static URL
- Marked "Update pricing model" task Done (was already implemented)

## Decisions

- Reverted PKCE OAuth flow — `launchWebAuthFlow` couldn't load the Supabase authorize page with PKCE params. Implicit flow works reliably. PKCE not required for CWS review. May revisit if Chrome/Supabase improve support.
- DM Sans for extension font — geometric, warm, pairs well with neobrutalist UI. Considered Inter (too generic) and Space Grotesk (too quirky).

## Issues

- "User not found" on non-fresh profile: turned out to be stale column names in `/me` SELECT, not an auth issue. Supabase silently errors on nonexistent columns, which hit the `if (error || !user)` check.
- Video duration showing ad length when no adblocker — `span.ytp-time-duration` reflects whatever is playing (ads included). Fixed by reading `meta[itemprop=duration]` structured data instead.
- WXT dev server didn't hot-reload summaries page after editing — had to restart dev server and reload extension manually.

## What to remember

- Supabase query errors are silent — check `error` object, don't assume "not found"
- `launchWebAuthFlow` + Supabase PKCE = broken (as of Mar 2026)
- `chrome.storage.local` is not accessible from sidepanel DevTools console — use service worker console
- YouTube's `span.ytp-time-duration` shows ad duration during ad playback — use `meta[itemprop=duration]` for actual video length
- WXT dev server doesn't always hot-reload separate HTML pages (summaries.html) — reload extension manually

---

## Commits

- `a275731` fix 6 auth bugs + stale column name in /me endpoint
- `e841eb5` revert PKCE flow, improve sign-in error UX
- `b7225ef` show friendly error messages, log raw errors to console
- `dd056ed` UI polish, ad-proof duration, free limit to 5/mo
- `039f601` add dark mode, neon green accent, accurate transcript timestamps

## Session 2 — Dark Mode & Transcript Timestamps

**TL;DR:** Added `prefers-color-scheme` dark mode using semantic CSS tokens, swapped indigo accent to custom neon green, and embedded real timestamps from YouTube caption XML into the transcript text so Claude can produce accurate timestamps.

### What got done

- **Dark mode** via `@media (prefers-color-scheme: dark)` with semantic CSS custom properties (surface, border, text tokens)
- Iterated on dark mode values — toned down borders (`#505050` vs bright white), reduced shadow opacity (0.12), bumped surface from near-black to gray (`#1e1e1e`), brightened all text tiers
- **Color rebrand**: indigo → emerald → custom neon green palette (`#39ff14` family) defined in `@theme`
- Upgrade buttons changed from amber to purple
- "Pop out" button now always visible in sidepanel top bar
- **Accurate transcript timestamps**: YouTube caption XML has per-segment `t="ms"` attributes — these were being discarded. Now `[M:SS]` markers are embedded every ~30s in the transcript text so Claude references real times instead of guessing
- Updated summarizer prompt to tell Claude to use the embedded `[M:SS]` markers
- Fixed timestamp column width (`w-10` → `w-14`) for `H:MM:SS` format timestamps

### Decisions

- Semantic CSS tokens over Tailwind `dark:` prefix — tokens in one CSS file, components stay clean. Shadows already lived in CSS anyway.
- Custom neon green palette over Tailwind emerald — user preferred electric green aesthetic. Defined `--color-neon-*` shades in `@theme`.
- 30s interval for transcript timestamp markers — balances precision vs transcript bloat. Claude can still interpolate between markers.

## Session 3 — Stripe Checkout & Billing Portal

**TL;DR:** Wired up Stripe Checkout and Billing Portal end-to-end. Extension upgrade buttons now hit the real checkout API instead of a dead URL. Debugged 4 production issues (env vars, URL prefixes, trailing newlines, test vs live price IDs). Added billing portal access for Pro users, auto-refresh on plan change, and archive icon for queue items.

### What got done

- **Stripe checkout flow**: Extension upgrade buttons call `POST /billing/checkout` → opens Stripe Checkout in new tab → webhook updates DB → sidepanel auto-refreshes
- **`openCheckout()`\*\*** helper\*\* (`lib/checkout.ts`): Creates checkout session, opens tab, listens for success URL via `browser.tabs.onUpdated`, triggers `onSuccess` callback
- **Auto-refresh on plan change**: `visibilitychange` listener re-fetches user + usage when sidepanel regains focus (for all users, not just free)
- **Billing portal**: Pro badge in footer is clickable purple button → opens Stripe Billing Portal for subscription management
- **Bigger upgrade CTA**: Full-width amber button with `shadow-brutal-sm` in UsageBar
- **Archive icon**: Replaced X (close) icon with archive box icon on queue items
- **9 unit tests** for billing routes (checkout with/without existing customer, portal, success/cancel pages, error paths)
- **Env var setup**: Added `STRIPE_PRICE_ID_PRO` and `API_URL` to Vercel production
- **Supabase MCP**: Set up for direct DB access — used to toggle user plans during testing

### Issues

- **Checkout 500 — \*\***`API_URL`\***\* not set**: Vercel didn't have `API_URL` env var → `success_url` was `undefined/billing/success`. Fixed by adding it.
- **Checkout 500 — missing \*\***`/api`\***\* prefix**: Routes mounted under `/api` but `stripe.ts` URLs were `/billing/success` not `/api/billing/success`. Fixed URLs.
- **Checkout 500 — trailing newline in env vars**: `echo "value" | vercel env add` appends `\n`. Stripe rejects URLs with newlines. Fixed: `printf '%s' 'value' | vercel env add`.
- **Checkout 500 — wrong price ID**: Had live mode price ID, needed test mode. User provided correct test mode ID.
- **Type error in summaries page**: `onClick={openCheckout}` passed `MouseEvent` as `onSuccess` param. Fixed: `onClick={() => openCheckout()}`.

### What to remember

- `printf '%s'` not `echo` when piping env values to `vercel env add` — echo adds trailing newline
- Stripe price IDs are different between test and live mode — always verify which mode you're using
- Hono routes mounted under `/api` prefix — all URL construction must include `/api`
- `browser.tabs.onUpdated` is great for watching a specific tab's URL changes (e.g. waiting for checkout success redirect)

---

### Commits

- `7fd5627` implement checkout/portal routes, privacy policy
- `6018569` fix checkout onClick type error, add Stripe error test

### What to remember

- `prefers-color-scheme` in Chrome extensions follows Chrome's appearance setting, not just OS — works per-profile
- Chrome profile accent color (toolbar tint) is separate and not accessible to extensions
- Neon green on dark backgrounds: readable. On light backgrounds: use darker shades (600+) for text contrast
- Tailwind v4 custom colors in `@theme` with `--color-{name}-{shade}` syntax auto-generate utilities like `text-neon-500`

---

## Session 4 — Error Handling & Failure UX

**TL;DR:** Implemented comprehensive error handling across the stack — users now see why summaries fail, rate limits show specific messages, offline detection works, and Claude API calls have a timeout.

### What got done

- **Error messages in UI**: Failed summaries now show `errorMessage` from DB in red text under the video title in QueueList
- **Claude API error classification** in Inngest worker (`summarize-video.ts`):
  - `APIConnectionError` → retryable (let Inngest retry)
  - `APIError` 429/500/503 → retryable
  - JSON parse failures → `NonRetriableError` with user-friendly message
  - Unknown errors → let Inngest retry with backoff
- **120s timeout** on Anthropic client to prevent indefinite hangs
- **Rate limit UX**: Extension now detects `RATE_LIMITED` code, shows "Monthly limit reached (X/X summaries on free plan). Upgrade for more." instead of generic error
- **Offline detection**: `TypeError` from `fetch()` caught in `api.ts`, shows "You're offline. Check your connection and try again."
- **Background script**: Forwards `RateLimitError` and `ProRequiredError` details from API client to sidepanel

### Files changed

- `apps/server/src/services/summarizer.ts` — 120s timeout
- `apps/server/src/functions/summarize-video.ts` — error classification
- `apps/extension/lib/api.ts` — `RateLimitError` class, offline detection, 429 handling
- `apps/extension/components/QueueList.tsx` — render `errorMessage` for failed items
- `apps/extension/entrypoints/sidepanel/App.tsx` — rate limit UX
- `apps/extension/entrypoints/background.ts` — forward error details
