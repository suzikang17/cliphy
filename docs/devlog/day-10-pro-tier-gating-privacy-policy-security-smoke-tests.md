---
day: 10
date: 2026-02-28
phase: MVP
mood: 🔥 Locked In
hours:
tags: [frontend, backend]
published_to: []
public: false
title: "Day 10 — Pro tier gating, privacy policy, security smoke tests"
---

Parallelized three tasks: pro tier gating (feature), privacy policy (legal), and automated security smoke tests. All merged and pushed in 4 commits. Created a manual testing ticket for post-deploy validation.

## What got done

- **Pro tier gating** — `requirePro()` middleware returns 402 + upgrade URL for free users. Batch queue gated, history limited to 7 days, ProBadge + UpgradePrompt components in extension UI. Shared constants for plan limits and feature identifiers. (`bcbba4a`)
- **Privacy policy** — server-rendered HTML page at `/privacy` covering data collection, AI disclosure (Anthropic), GDPR rights, retention policy. Vercel rewrite configured. (`481abf4`)
- **Security smoke tests** — automated 8 of 9 manual security hardening checklist items as live smoke tests: removed endpoint 404, security headers, CORS blocking, input validation (long titles, special chars), Stripe webhook signature. All pass against prod. (`9e2afa2`)
- **Flaky test fix** — DELETE smoke test now accepts both 200 and 409 since Inngest can race the item to processing status. (`9e2afa2`)
- **Security hardening cleanup** — remaining transcript sanitization item. (`80600e4`)

## Issues

- **Worktree merge complexity** — parallel agents in worktrees made uncommitted changes. When worktrees were removed, untracked new files were lost. Had to recreate `privacy.ts` manually. Lesson: agents in worktrees should commit their work before the worktree is removed.
- **Smoke test triple-run** — worktree copies of smoke test file were picked up by vitest, causing 3 concurrent test users to queue the same video, leading to DELETE 409 failures. Fixed by removing worktrees before re-running.

## What to remember

- Worktree agents should always commit before worktree removal — untracked files vanish
- `git diff` patches don't include untracked files — need `git diff` + manual copy for new files
- Smoke test DELETE is inherently racy against Inngest — accept both 200/409

---

## Commits

- `80600e4` — complete remaining security hardening items
- `bcbba4a` — add pro tier gating with 402 responses and upgrade prompts
- `481abf4` — add /privacy route with server-rendered privacy policy page
- `9e2afa2` — add security hardening smoke tests and fix flaky DELETE test

## Task details

### Pro tier gating

- New `requirePro(feature)` middleware in `apps/server/src/middleware/require-pro.ts`
- Shared: `FREE_HISTORY_DAYS`, `UPGRADE_URL`, `PRO_FEATURES` enum, `ProRequiredResponse` type
- Backend: batch route gated with middleware, summaries uses shared constant for 7-day limit
- Extension: `ProRequiredError` class, `ProBadge` + `UpgradePrompt` components, upgrade CTAs in UsageBar/sidepanel/summaries
- Tests: batch test updated to expect 402 with code/feature/upgrade_url

### Privacy policy

- `apps/server/src/routes/privacy.ts` — Hono route returning styled HTML
- Registered in app.ts, Vercel rewrite `/privacy` → `/api/privacy`

### Security smoke tests

- 8 tests in `apps/server/scripts/smoke-test-api.test.ts` under "Security Hardening" describe block
- Tests: summarize 404, headers, CORS (GET + preflight), long title 400, special chars search 200, webhook sig 400 (missing + invalid)

## Tomorrow's plan

- Deploy and run manual testing checklist (new Notion ticket created)
- Create Stripe webhook + set STRIPE_WEBHOOK_SECRET env var
- Test full payment flow in Stripe test mode
