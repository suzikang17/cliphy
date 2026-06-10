---
day: 65
date: 2026-06-09
phase: Growth
tags: [feature, server, extension, admin, billing]
title: "Day 65 — Admin grants: one-off credit wallet + recurring monthly bonus"
---

## TL;DR

Started from "is the admin-set monthly limit working?" — answer: there was no
admin-set limit. The admin panel's "Set count" only edited the usage _counter_,
and setting it to 10 on a free plan (cap 5) had silently blocked the test
account. Built the real thing: two admin levers — a one-off credit wallet that
carries over, and a recurring monthly bonus added to the plan cap. Shipped to
prod and verified live.

## What got done

- **Migration 015 (applied to prod).** Added `bonus_credits` (one-off wallet,
  carries over) and `monthly_limit_bonus` (recurring, added to the monthly cap)
  to `users`. Rewrote `increment_monthly_count` + `_batch` to spend the monthly
  allowance first, then draw from the wallet — all inside the RPC, same return
  types, so every consume path inherits it.
- **All six consume paths** (single enqueue, batch, retry, translate,
  auto-subscribe) now pass `limit = PLAN_LIMITS[plan] + monthly_limit_bonus`.
- **Admin UI.** User detail → Usage card gained a "Monthly bonus" (Set) row and a
  "One-off credits" (Grant, +/−) row, with `grantCredits` + `setMonthlyBonus`
  service fns + routes. The old Set/Reset count buttons stayed as debug knobs.
- **Surfacing.** `UsageInfo.bonusCredits` added; `usage` endpoint returns the
  effective limit + wallet; extension `UsageBar` shows `+N credits` and no longer
  reads "Limit reached" while credits remain.
- **Tests.** Added a usage-endpoint case for recurring bonus + wallet. All 279
  unit tests green; shared/server/extension typecheck clean.
- **Shipped.** Commit `43db02d` → push → Vercel prod deploy Ready. Verified live:
  `api.cliphy.app` 200, wallet drained 2→0 then blocked, recurring +10 lifted
  cap 5→15.

## Decisions

- **Additive recurring bonus over absolute override** — composes with a later
  plan upgrade instead of capping a pro user below their tier. (ADR 0040)
- **Consume monthly first, then wallet** — grant acts as overflow buffer.
- **Wallet logic inside the consume RPC; `decrement_*` left unchanged** — rollback
  is called across the Inngest worker boundary where the consume source is
  unknown, so threading source is infeasible. Refund lands as a monthly slot in
  the rare wallet-consume-then-fail case; user is never wrongly blocked. (ADR 0040)

## Issues

- The original report ("admin set monthly limit not working") was a feature that
  never existed — "Set count" edits the counter, not a cap. Setting it to 10 on
  free (cap 5) had blocked the account. Reset to a clean state during testing.
- `pnpm lint` fails on 4 pre-existing `apps/mobile/` config files (metro/babel/
  polyfills/ShareExtensionPreprocessor) — unrelated to this change, already on
  main.

## What to remember

- Admin "Grant" adds to `bonus_credits` (one-off, carries over). "Monthly bonus"
  sets `monthly_limit_bonus` (recurring). "Set count" is still just a debug knob
  on the usage counter — it is NOT a limit.
- Effective monthly cap = `PLAN_LIMITS[plan] + monthly_limit_bonus`; wallet is
  spent only after that's exhausted.
- Web + mobile UsageBars get the corrected higher cap automatically but don't yet
  render the wallet — follow-up.

---

## Commits

- `43db02d` — add admin grant levers: one-off credits + recurring monthly bonus
- ADR `0040-admin-grant-credits-and-monthly-bonus.md`
- Migration `015_grant_credits.sql` (applied to prod project umwtegoeewjmxxlihgtm)
