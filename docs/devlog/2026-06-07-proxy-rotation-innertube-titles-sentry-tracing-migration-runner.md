---
day: 63
date: 2026-06-07
phase: Growth
mood: 🔧 Deep debugging
hours:
tags: [infra, bugfix, observability]
published_to: []
title: "Day 63 — Proxy rotation fix, InnerTube titles, Sentry tracing, migration runner"
---

## TL;DR

Root-caused why summaries were failing in prod (sticky proxy port → YouTube per-IP throttle) and fixed it by switching Decodo to the rotating port. Along the way: replaced the YouTube on-page buttons with a right-click menu, moved title resolution to InnerTube (dropped oEmbed), enabled Sentry tracing, sized Inngest concurrency to the Anthropic ITPM limit, resolved an Inngest `account_mismatch`, and built a custom migration runner.

## What got done

- **Right-click context menu** replaces the DOM-injected action button + thumbnail overlays on YouTube (fragile against YT markup churn). Content script scrapes title/channel/duration on `contextmenu`, background pulls via `GET_QUEUE_METADATA`, on-page toast feedback. (`5134135`)
- **Fixed prod summary failures** — `PROXY_URL` was on a Decodo **sticky** port (`:10001`), funneling every concurrent transcript fetch through one residential IP → YouTube per-IP rate limit → connect timeouts under burst. Switched to the **rotating port `:7000`** (prod env change). Verified from Vercel: the burst that died 40/40 on sticky now passes 40/40. (ADR 0036)
- **Legible network errors** — `fetchViaProxy` now unwraps undici's hidden `error.cause`, so "fetch failed" becomes e.g. `ConnectTimeoutError … www.youtube.com:443`. Broadened the worker error classifier. (`58d2635`)
- **Video title from InnerTube** `videoDetails` the worker already fetches (title/channel/duration backfilled in the worker) — dropped the oEmbed call entirely. (`49ce4c8`, ADR 0037)
- **Sentry performance tracing** on the server — `tracesSampleRate: 1.0` + per-request `Sentry.flush` in the Vercel serverless entry (successful-request traces were never flushed before). (`7d81412`)
- **Concurrency sized to Anthropic ITPM** — Tier 2 = 450k ITPM ÷ ~63k tokens/summary ≈ 5; Inngest `concurrency: [{key: userId, limit: 2}, {limit: SUMMARIZE_CONCURRENCY||5}]`. (`1bc49bf`)
- **Failure categorization** — `error_category` column (migration `013`) written by the worker's `onFailure` + a `no_captions` classifier, for admin triage. (`cc514e5`)
- **Proxy-test harness** (`pnpm test-proxy`) + admin debug endpoint (`/api/admin/proxy-test`) to reproduce/measure the proxy from Vercel under concurrency. (`6a73273`)
- **Custom migration runner** (`pnpm migrate` — `run`/`status`/`baseline`/`check`, transactional, tracked in `schema_migrations`) + CI status-check step. Baselined `001–012`, applied `013`. (uncommitted — rides with the deps batch; ADR 0038)
- Installed Supabase agent skills into `.agents/skills/`.

## Decisions

- Rotating Decodo proxy port over sticky → ADR 0036
- Video title from InnerTube `videoDetails` over oEmbed / YouTube Data API → ADR 0037
- Custom `pg` migration runner over Supabase CLI / auto-on-boot → ADR 0038

## Issues

- **Summaries failing (connect timeouts via proxy).** Root cause: sticky proxy port = one IP hammered past YouTube's per-IP rate limit under burst. Not a Decodo concurrency cap (residential = unlimited concurrent sessions; the binding limit is YouTube per-IP + the 3GB bandwidth plan). Fix: rotating port `:7000`.
- **Inngest `account_mismatch` on sync** = duplicate `vercel_apps` row (the Vercel project was claimed by a stale/other Inngest account record; surfaced as a `duplicate key … vercel_apps_project_id_key` error when saving the integration). Fix: uninstall/reinstall the Inngest↔Vercel integration, set custom production domain = `api.cliphy.app` (sidesteps Vercel Deployment Protection on per-deploy URLs), delete the stale **manual** `INNGEST_SIGNING_KEY`/`INNGEST_EVENT_KEY` so the integration re-injects fresh ones. Concurrency config only takes effect after a green sync (verified `PUT /api/inngest` → 200).

## What to remember

- `PROXY_URL` must use Decodo's **rotating port 7000**, never a sticky port, for the concurrent summarize workload.
- Concurrency ceiling = Anthropic **ITPM ÷ ~63k tokens/summary**; read live limits from `anthropic-ratelimit-*` response headers (`pnpm migrate`-style probe in the session).
- Migrations: `pnpm migrate` needs `DATABASE_URL` (Supabase **session pooler**, port 5432 — not the 6543 transaction pooler) in `apps/server/.env.local`. Baseline once, then forward-only. Don't auto-run on Vercel; fold into the VPS deploy script when we move.
- **Held/uncommitted** (tangled with concurrent WIP): admin failure-type filter (`summaries.tsx`, depends on the new `format.ts` refactor) and the migration-runner files (`migrate.ts`, `pg` dep + lockfile, `ci.yml` — tangled with mobile/shared deps WIP).

---

## Commits

- `5134135` replace YouTube on-page buttons with right-click context menu
- `58d2635` resolve video titles via oEmbed; surface real network errors _(oEmbed later removed)_
- `7d81412` enable Sentry performance tracing on the server
- `6a73273` add proxy-test harness + admin debug endpoint
- `49ce4c8` get video title from InnerTube; cap summarize concurrency
- `1bc49bf` size summarize concurrency to Anthropic ITPM + per-user fairness
- `cc514e5` classify + persist failure category on summaries

Plus prod env changes (no commit): `PROXY_URL` `:10001`→`:7000`, Sentry `SENTRY_DSN` tracing on, Inngest integration reconnect + `INNGEST_*` keys re-injected, `DATABASE_URL` added to `.env.local`.
