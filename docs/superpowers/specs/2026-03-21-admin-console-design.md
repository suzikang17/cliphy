# Admin Console Design

**Date:** 2026-03-21
**Status:** Draft

## Overview

A server-rendered admin console built into the existing Hono server using Hono JSX and HTMX. Provides operational visibility and actions for managing users, summaries, billing, and system health. Accessed via `/api/admin/*` routes (under the existing `/api` basePath). Solo-admin use only (for now).

## Architecture

### Tech Stack

- **Rendering:** Hono built-in JSX (server-side)
- **Interactivity:** HTMX (loaded from CDN)
- **Styling:** Minimal inline CSS / single `<style>` block in layout — no build step
- **Data:** Supabase service_role client (existing) + Stripe SDK (existing)
- **Auth:** Env-var secret (`ADMIN_SECRET`) with cookie-based session
- **New dependencies:** None (but requires tsconfig + esbuild JSX config changes)

### JSX Configuration

Hono JSX requires tsconfig and esbuild changes:

- **tsconfig** (server): add `"jsx": "react-jsx"`, `"jsxImportSource": "hono"` to compilerOptions
- **esbuild** (`scripts/build-vercel.sh`): add `--jsx=automatic --jsx-import-source=hono` flags

### Route Structure

All admin routes mount under the existing `/api` basePath, so URLs are `/api/admin/*`.

```
apps/server/src/
  routes/
    admin/
      index.ts        — admin Hono app (mounts sub-routes)
      middleware.ts    — auth guard middleware
      users.tsx        — user list, detail, actions (JSX views co-located)
      summaries.tsx    — summary browser, failed view
      queue.tsx        — queue monitor
      login.tsx        — login page
    admin-views/
      layout.tsx      — base HTML shell (HTMX script, styles, nav)
      components.tsx  — reusable table, stats-card, pagination components
```

Views are co-located with routes where possible. Shared layout and components live in `admin-views/`.

### Authentication

- `GET /api/admin/login` — renders a simple password form
- `POST /api/admin/login` — validates against `ADMIN_SECRET` env var, sets an HTTP-only signed cookie
- Cookie is HMAC-signed using `ADMIN_SECRET` as the key (e.g. `value.signature` format) with `Max-Age=86400` (24h)
- Middleware on all `/api/admin/*` routes (except login) verifies the cookie signature
- No Supabase auth involved — just a shared secret for solo use
- **Env vars needed:** `ADMIN_SECRET` (add to Vercel for all environments)

### HTMX Pattern

- Initial page loads return full HTML (layout + content)
- Subsequent interactions (search, filter, paginate, actions) return HTML fragments
- HTMX swaps fragments into the page without full reload
- **HTMX delivery:** Self-hosted — serve HTMX JS inline in the layout `<script>` tag or from a dedicated route (avoids CSP issues with CDN and `secureHeaders()` middleware)
- Key HTMX features used:
  - `hx-get` / `hx-post` — fetch/submit to admin routes
  - `hx-target` — specify swap target
  - `hx-trigger="keyup changed delay:300ms"` — debounced search
  - `hx-trigger="every 10s"` — queue stats polling
  - `hx-confirm` — confirmation dialogs for destructive actions
  - `hx-swap="outerHTML"` — replace elements after actions

### Middleware Considerations

- **CORS:** The existing origin-check middleware in `app.ts` will block HTMX POST requests from the admin UI. Admin routes should skip the origin check (admin middleware handles auth independently).
- **secureHeaders:** Admin routes should either be exempted from `secureHeaders()` or CSP should be configured to allow inline scripts (for HTMX).

## Phase 1: Users + Summaries + Queue

### User List (`GET /api/admin/users`)

**Table columns:** email, plan, subscription status, monthly count, created date

**Filters:**

- Plan: free / pro / all (dropdown)
- Subscription status: all / active / canceled / past_due / none (dropdown)
- Email search: text input with debounced HTMX search

**Pagination:** 25 per page, HTMX-powered next/prev

**Interaction:** Click row → user detail page

**Query:** `SELECT * FROM users` with optional `WHERE plan = ?`, `WHERE email ILIKE ?`, `ORDER BY created_at DESC`, `LIMIT 25 OFFSET ?`

### User Detail (`GET /api/admin/users/:id`)

**Sections:**

- Profile: email, plan, subscription status, Stripe customer ID, Stripe subscription ID, trial_ends_at, created_at
- Usage: monthly_summary_count / limit, monthly_count_reset_at, total summaries count
- Recent summaries: last 20 summaries (title, status, created date) — click through to summary detail

**Actions panel:**

- Upgrade to Pro — `hx-post` with `hx-confirm`, sets `plan = 'pro'`, `subscription_status = 'active'` (manual admin override, no Stripe checkout)
- Downgrade to Free — extract logic from `downgrade-user.ts` into a shared `services/admin.ts` function, then call from both the script and admin route (cancel Stripe sub, set plan/status/fields)
- Cancel Stripe subscription — Stripe API call + update subscription_status
- Reset monthly count — set monthly_summary_count to 0

Each action returns the updated user detail fragment so the page reflects changes immediately.

### Summary Browser (`GET /api/admin/summaries`)

**Table columns:** video title, user email, status (badge), tags, created date

**Filters:**

- Status: all / pending / processing / completed / failed (dropdown)
- Date range: from/to date inputs
- Search: video title or YouTube video ID (debounced)

**Pagination:** 25 per page

**Detail view** (`GET /api/admin/summaries/:id`):

- Full summary JSON (formatted)
- Error message (if failed)
- Transcript preview (first 500 chars)
- User info (email, plan)
- Tags
- Video metadata (channel, duration, URL)

**Failed summaries tab:** Pre-filtered view (`?status=failed`) showing error messages inline in the table.

### Queue Monitor (`GET /api/admin/queue`)

**Stats cards (top of page):**

- Pending count
- Processing count
- Failed count
- Completed today count

Stats auto-refresh via `hx-trigger="every 10s"`.

**Recent items table:** Last 50 summaries ordered by created_at DESC, showing video title, user email, status badge, created time.

## Phase 2: Billing + Retry (Future)

### Billing Overview (`GET /api/admin/billing`)

- Stats cards: active subscriptions, MRR (from Stripe), trialing count
- Recent subscription events table (from Stripe API)
- Quick links to Stripe Dashboard

### Retry Failed Summaries

- Button on each failed summary row: re-triggers `video/summarize.requested` Inngest event
- Bulk retry: select multiple or "retry all failed" button
- Returns updated status badge via HTMX swap

## Phase 3: Cache + System Stats (Future)

### Cache Management (`GET /api/admin/cache`)

- Summary cache table: youtube_video_id, video_title, hit_count, created_at
- Clear individual entries (DELETE button)
- Bulk clear option
- Total cache size / hit rate stats

### System Stats (`GET /api/admin/stats`)

- Summaries per day (simple bar chart or table)
- API error counts (from logs or Sentry)
- Usage trends (monthly active users, summaries created)

## Data Access

All admin queries use the existing Supabase service_role client. No new database functions, tables, or migrations needed for Phase 1.

**Read queries:** Direct SELECTs with filters, joins (summaries + users for email), aggregates (COUNT by status).

**Write operations:**

- User plan changes: `UPDATE users SET plan = ?, subscription_status = ?`
- Subscription cancel: Stripe SDK `subscriptions.cancel()` + DB update
- Monthly count reset: `UPDATE users SET monthly_summary_count = 0`

All mutations are idempotent and use `hx-confirm` before execution.

## Security Considerations

- Admin routes are completely separate from the user-facing API
- Auth is env-var secret — acceptable for solo use, would need proper RBAC if adding more admins
- All actions require confirmation dialogs
- No client-side state — everything is server-rendered, no XSS surface from JS frameworks
- HTMX requests include the auth cookie automatically
