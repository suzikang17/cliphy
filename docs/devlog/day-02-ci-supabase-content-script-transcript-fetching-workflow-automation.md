---
day: 2
date: 2026-02-17
phase: MVP
mood: 😎 Smooth
hours:
tags: []
published_to: [None Yet]
public: false
title: "Day 2 — CI, Supabase, content script, transcript fetching, workflow automation"
---

## What got done

- **Set up CI pipeline (GitHub Actions)** — created `.github/workflows/ci.yml`
  - Runs on push/PR to main: lint → typecheck (shared, extension, server) → test
  - Uses `pnpm/action-setup@v4` + `actions/setup-node@v4` with `.nvmrc` for Node 22
  - pnpm store cached via `actions/setup-node` cache option
- **Fixed ESLint ignoring build artifacts** — `.output/` and `.wxt/` directories weren't in the ignore list, causing 87 lint errors from generated code
- **Fixed TypeScript errors in extension** — `browser.runtime.onMessage` callback types `message` as `unknown` in WXT; added `as { type: string }` casts in `background.ts` and `youtube.content.ts`
- **Updated Stripe API version** — `stripe` package bumped its types to require `2025-02-24.acacia`, old `2025-01-27.acacia` string no longer compiled
- **Added \*\***`vitest.config.ts`\*\* — set `passWithNoTests: true` so CI doesn't fail before test files exist
- **Set up Supabase project** — created project, configured API keys, enabled Google OAuth
  - Used new key format (`sb_publishable_` / `sb_secret_`) — confirmed compatible with `supabase-js` v2.95.3
  - Google OAuth: created Google Cloud OAuth client ID (Web application type), set redirect URI to Supabase callback, enabled Google provider in Supabase Auth

## Issues hit

- **ESLint linting WXT build artifacts** — `.output/` (compiled extension) and `.wxt/` (generated types with triple-slash refs) weren't ignored. Fix: added both to `ignores` array in `eslint.config.js`
- **Vitest v4 exits 1 with no test files** — `--passWithNoTests` CLI flag doesn't work in Vitest v4. Fix: created `vitest.config.ts` with config-level `passWithNoTests: true`
- **Stripe type version drift** — installed `stripe` package types expect a newer API version string than what was hardcoded. Fix: updated version string to `2025-02-24.acacia`

## What to remember

- WXT generates `.output/` and `.wxt/` directories that should always be in ESLint ignores
- Vitest v4: use config file for `passWithNoTests`, not CLI flag
- `browser.runtime.onMessage` listener `message` param is typed as `unknown` — cast or narrow before accessing properties
- Keep Stripe `apiVersion` string in sync with installed `stripe` package version
- Supabase new API keys (`sb_publishable_` / `sb_secret_`) are drop-in replacements for legacy `anon` / `service_role` keys
- Google OAuth for Chrome extensions still uses "Web application" type — the auth flow goes through Supabase's redirect URL, not Chrome's Identity API

## Commits

- `dbe9dd3` — add GitHub Actions CI pipeline
- `ba09350` — add initial Supabase schema migration
- `224e2ca` — rename default branch from master to main

### Rename default branch to main

### Set up Stripe account

- Stripe account already created in test mode with products (Pro Monthly $7/mo, Pro Yearly $60/yr)
- Saved API secret key and price IDs to `.env`
- Webhook secret deferred — part of the "Stripe integration" task when backend is deployed
- No publishable key env var needed — checkout goes through backend-generated URLs
- Renamed `master` → `main` (local + remote)
- Updated `.github/workflows/ci.yml` to trigger on `main`
- Set GitHub default branch to `main`, deleted old `master` remote
- [CLAUDE.md](http://claude.md/) already referenced `main` — no changes needed
- `224e2ca` — rename default branch from master to main

## CI pipeline details

Runs on push/PR to `main`, single job:

1. **Format check** — `prettier --check .`
1. **Lint** — ESLint
1. **Typecheck** — `tsc --noEmit` for shared, extension, server
1. **Build** — WXT build (extension) + tsc (server)
1. **Test** — Vitest

## Tasks completed

### Set up CI pipeline (GitHub Actions)

- Created `.github/workflows/ci.yml` — single job, runs on push/PR to main
- Steps: format check → lint → typecheck (shared, extension, server) → build (extension + server) → test
- Caches pnpm store via `actions/setup-node` for faster runs
- Fixed 4 blockers to get CI green: ESLint ignores for `.output/`/`.wxt/`, extension `unknown` message types, Stripe API version mismatch, Vitest `passWithNoTests` config
- Files created/modified: `.github/workflows/ci.yml`, `vitest.config.ts`, `eslint.config.js`, `background.ts`, `youtube.content.ts`, `stripe.ts`, `summarizer.ts`

### Set up Supabase project

- Created Supabase project `cliphy` (free tier)
- Used new-format API keys (`sb_publishable_` / `sb_secret_`) — confirmed compatible with `supabase-js` v2.95.3, no code changes needed
- Configured Google OAuth: created Google Cloud OAuth client (Web application type), redirect URI → `https://umwtegoeewjmxxlihgtm.supabase.co/auth/v1/callback`, enabled Google provider in Supabase Auth dashboard
- All keys saved to local `.env` (URL, publishable key, secret key)

### Initial database schema migration

- Created `apps/server/supabase/migrations/001_initial_schema.sql` — 3 tables, 2 enums, RLS, functions, triggers
- **Tables:** `users` (linked to `auth.users` via FK), `summaries` (unified queue + result), `summary_cache` (shared across users)
- **Security:** SELECT-only RLS policies on all tables — no client-side writes. All mutations via backend `service_role`
- **Rate limiting:** `increment_daily_count()` function — atomic check-and-increment to prevent TOCTOU race condition
- **Auth trigger:** `handle_new_user()` auto-creates `public.users` row on signup
- Updated `packages/shared/src/types.ts` — unified `QueueItem` + `Summary` into single `Summary` type matching DB schema, added `SummaryJson` interface
- Updated `apps/extension/lib/api.ts` to use unified `Summary` type
- Migration ran successfully in Supabase SQL Editor — verified RLS policies and function exist
- `ba09350` — add initial Supabase schema migration

### Content script: YouTube page detection

- Built out `youtube.content.ts` — extracts channel name and video duration from YouTube DOM alongside existing videoId/title/url
- Added SPA navigation detection via YouTube's `yt-navigate-finish` custom event — sends `VIDEO_DETECTED` message to background script on video page navigation
- Also fires on initial page load if already on a video page
- Background script handles `VIDEO_DETECTED` with console log (queue integration deferred)
- Created `packages/shared/src/messages.ts` with typed `ExtensionMessage` union — replaces raw `{ type: string }` casts
- `b36127c` — add content script video detection with SPA navigation support

### Bug fix: Chrome renderer CPU spike

- `return true` in `runtime.onMessage` listeners was keeping message ports open for every message, even fire-and-forget ones like `VIDEO_DETECTED` — caused Chrome renderer processes to pin at 100%+ CPU
- Fix: only `return true` for `ADD_TO_QUEUE` (which actually uses async `sendResponse`), removed from content script entirely
- Switched `dev:extension` from `wxt dev` (launches fresh Chrome profile) to `wxt build --watch` + manual load-unpacked — faster, uses real browser profile, no CAPTCHAs/403s
- `9040b10` — fix message listener keeping ports open and switch to watch-based dev workflow

### Transcript fetching

- Implemented `fetchTranscript()` in `apps/server/src/services/transcript.ts`
- First tried `youtube-transcript` (81k downloads/week) — broken, returns 0 segments
- Tested 4 other packages: `youtubei.js` (400 error), `youtube-caption-extractor` (empty), `@danielxceron/youtube-transcript` (ESM broken)
- Landed on `@egoist/youtube-transcript-plus` — uses YouTube Innertube API, works reliably
- Had to handle HTML entity double-encoding (`&amp;#39;` → `&#39;` → `'`) — two-pass decode
- Also researched Python `youtube-transcript-api` as fallback — works but adds deployment complexity for MVP
- Created follow-up task to stress-test and reconsider Python fallback
- `88e9c3d` — implement transcript fetching with @egoist/youtube-transcript-plus

### CI fix

- `pnpm/action-setup@v4` requires pnpm version to be specified
- Added `packageManager: pnpm@10.11.1` to root `package.json`

### Workflow automation

- Analyzed session patterns and identified 6 recurring workflow cycles
- Created `/ship` skill — verify (lint + build) → commit → push → update Notion in one flow
- Created `/update-notion` skill — marks task Done on Task Board, appends devlog, logs decisions
- Composable: `/ship` invokes `/update-notion`, and `/update-notion` works standalone for mid-session logging
- Added `.prettierignore` for `pnpm-lock.yaml` — CI was failing on Prettier check
- Saved WXT dev gotchas and workflow preferences to [MEMORY.md](http://memory.md/)
- `a12834c` — fix CI by specifying pnpm version in packageManager field
- `4b6f626` — add /ship and /update-notion skills, fix CI prettier on lockfile

### CI typecheck fix

- `onMessage` listeners must return `true` to satisfy WXT's `OnMessageListenerCallback` type
- Both `background.ts` and `youtube.content.ts` had return type mismatches (`void` / `true | undefined` instead of `true`)
- Root cause: we removed `return true` earlier to fix a CPU spike but didn't check typecheck
- Lesson: **we kept breaking CI because we only ran \*\***`pnpm lint`\***\* locally, not the full suite** (prettier, typecheck, build, test)
