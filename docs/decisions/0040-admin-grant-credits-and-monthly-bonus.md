---
title: "Admin grants: one-off credit wallet + recurring monthly bonus, enforced inside the consume RPCs"
date: 2026-06-09
category: Tech
revisit: false
---

## Why this choice

There was no way for an admin to give a specific user more summaries. The admin
panel only had "Set/Reset count", which edits the _usage counter_
(`monthly_summary_count`) — a debug knob, not a grant. The actual cap was always
`PLAN_LIMITS[plan]` (free 5, pro 100), hardcoded and not per-user overridable.
Setting a user's count to 10 on the free plan just blocked them (10 ≥ cap 5).

We added two independent admin levers on top of the plan limit:

- **`monthly_limit_bonus`** — recurring. Added to the plan cap every month
  (effective cap = `PLAN_LIMITS[plan] + monthly_limit_bonus`). For "this user
  permanently gets +N/mo". Additive rather than an absolute override so it
  composes with a plan upgrade (free+10 → pro+10) instead of silently capping a
  pro user below their tier.
- **`bonus_credits`** — one-off wallet. Carries over month to month and is spent
  only after the monthly allowance is exhausted. Never auto-resets. For comps,
  goodwill, support apologies.

Consume order is **monthly allowance first, then the wallet**, so the grant acts
as an overflow buffer and the normal quota is what burns first.

## Options considered

- **Keep editing the used counter** to fake headroom. Rejected: falsifies the
  usage number, resets monthly (grant evaporates on the 1st), not auditable,
  confusing semantics (set lower = more room).
- **Absolute per-user limit override** (`monthly_limit_override`, cap = N).
  Clean, but "custom tier" semantics; an override below a future plan upgrade
  silently caps the user. Rejected in favor of additive bonus.
- **One-off only vs recurring only.** Chose both — they answer different needs
  (permanent allowance vs one-time gift).
- **Return the consume _source_ from the RPC and thread it to a precise
  rollback.** Rejected: `decrement_*` is called across the Inngest worker
  boundary (the summarize worker rolls back on failure long after enqueue
  consumed), so the source can't be threaded. See tradeoffs.

## Where enforcement lives

All wallet + recurring logic is **inside `increment_monthly_count` /
`increment_monthly_count_batch`** (migration `015_grant_credits.sql`). They keep
their existing return types (boolean / int), so all six consume paths (single
enqueue, batch, retry, translate, auto-subscribe) get grants for free once they
pass the effective limit. The `usage` endpoint returns the effective limit +
`bonusCredits`; the extension `UsageBar` shows `+N credits` and no longer reads
"Limit reached" while credits remain.

## Tradeoffs

- **Rollback is intentionally imprecise.** `decrement_*` was left unchanged — it
  decrements the monthly counter (floor 0) and never touches the wallet. When a
  wallet credit was consumed and the op later fails, the refund lands as a
  monthly slot instead of a wallet credit. The user is never wrongly blocked;
  worst case a granted credit converts to a this-month slot. Chosen over
  threading consume-source across the Inngest boundary, which is infeasible.
- **Grant via read-modify-write** in `admin.ts` (`grantCredits`) rather than a
  SQL function. Fine for single-admin, low-concurrency edits; floors at 0 so a
  negative amount claws back safely.
- **Web/mobile UsageBars** get the corrected higher cap automatically (limit now
  includes the recurring bonus) but don't yet render the wallet — deferred.
