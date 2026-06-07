---
date: 2026-06-07
title: "Custom pg migration runner over Supabase CLI / auto-on-boot"
category: Tech
revisit: true
---

# Custom pg migration runner over Supabase CLI / auto-on-boot

**Date:** 2026-06-07 · **Category:** Tech · **Revisit?** yes

## Why this choice

Migrations (`apps/server/supabase/migrations/NNN_*.sql`) were applied by hand. Added a self-contained runner — `scripts/migrate.ts` (`pnpm migrate`) — that applies pending files in order, each in a transaction (failure rolls back fully), tracked in a `schema_migrations` table. Modes: `run` / `status` / `baseline <ver>` / `check` (CI gate). It's a ~100-line script + `pg`, no external service, and fits a future VPS deploy pipeline (`migrate → deploy`).

One-time **baseline** (`pnpm migrate baseline 012`) records the manually-applied `001–012` as done so the runner doesn't re-run them; `013` was the first real auto-applied migration.

## Options considered

- **Custom `pg` runner** (chosen) — self-contained, no CLI/keychain/token dance, uses `DATABASE_URL` directly, fits the VPS direction.
- **Supabase CLI (`db push` + `migration repair`)** — the native tool, but needs CLI auth + DB password + a baseline-repair of the manual history; the local CLI was also logged into the wrong account and the project wasn't linked. More moving parts for the same outcome.
- **Run migrations on app boot** — rejected; races across serverless cold starts, and deploy ≠ migrate.

## Tradeoffs

- We now own ~100 lines of runner code (vs a maintained CLI). Acceptable; it's simple and transactional.
- `DATABASE_URL` (Supabase **session pooler**, port 5432) must live in `.env.local` / CI secrets.
- **Not auto-run on Vercel** (no clean single pre-deploy hook; build env lacks a direct DB connection). Manual `pnpm migrate` before deploy + a CI `migrate check` warning for now. **Revisit** when the backend moves to the VPS: fold `migrate → restart` into the deploy script as a true auto-runner.
- Data-loss safety lives in discipline (expand/contract for destructive changes, backups/PITR, forward-only), not the runner.
