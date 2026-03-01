# Monthly Pricing Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace daily rate limits (5/day free, 100/day pro) with monthly limits (10/mo free, 100/mo pro).

**Architecture:** Rename DB columns from daily→monthly, swap the atomic rate-limit function to reset on month boundary instead of day boundary, update constants/types/UI to match.

**Tech Stack:** Supabase (Postgres), TypeScript, Hono, React, Vitest

---

### Task 1: Update shared constants and types

**Files:**

- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types.ts`

**Step 1: Update PLAN_LIMITS**

In `packages/shared/src/constants.ts`, change:

```ts
export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 10,
  pro: 100,
};
```

**Step 2: Update User interface**

In `packages/shared/src/types.ts`, rename fields in `User`:

```ts
export interface User {
  // ... other fields unchanged ...
  monthlySummaryCount: number;
  monthlyCountResetAt: string;
  // ... rest unchanged ...
}
```

Remove `dailySummaryCount` and `dailyCountResetAt`.

**Step 3: Verify build**

Run: `pnpm --filter @cliphy/shared build`
Expected: Build succeeds (or if no build step, just verify no TS errors)

**Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types.ts
git commit -m "update shared types and constants to monthly rate limits"
```

---

### Task 2: Write DB migration

**Files:**

- Create: `apps/server/supabase/migrations/005_monthly_rate_limits.sql`

**Step 1: Write the migration**

```sql
-- Migrate from daily to monthly rate limits

-- Rename columns
alter table public.users rename column daily_summary_count to monthly_summary_count;
alter table public.users rename column daily_count_reset_at to monthly_count_reset_at;

-- Update comments
comment on column public.users.monthly_summary_count is
  'Number of summaries requested this month. Reset when monthly_count_reset_at < first of current month.';
comment on column public.users.monthly_count_reset_at is
  'Date the monthly_summary_count was last reset. Compared to first of current month to decide whether to reset.';

-- Drop old function
drop function if exists public.increment_daily_count;

-- Create monthly version
create or replace function public.increment_monthly_count(p_user_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.users
  set
    monthly_summary_count = case
      when monthly_count_reset_at < date_trunc('month', current_date)::date then 1
      else monthly_summary_count + 1
    end,
    monthly_count_reset_at = current_date
  where id = p_user_id
    and (
      monthly_count_reset_at < date_trunc('month', current_date)::date  -- new month, reset
      or monthly_summary_count < p_limit                                 -- under limit
    )
  returning monthly_summary_count into v_count;

  return v_count is not null;
end;
$$;

comment on function public.increment_monthly_count is
  'Atomically checks monthly rate limit and increments count. Returns true if under limit, false if at/over. Resets on new month.';
```

**Step 2: Commit**

```bash
git add apps/server/supabase/migrations/005_monthly_rate_limits.sql
git commit -m "add migration to switch from daily to monthly rate limits"
```

---

### Task 3: Update usage route and tests

**Files:**

- Modify: `apps/server/src/routes/usage.ts`
- Modify: `apps/server/src/routes/__tests__/usage.test.ts`

**Step 1: Update the tests first**

In `usage.test.ts`, update all mock data and assertions:

- Change `daily_summary_count` → `monthly_summary_count` in all mock data
- Change `daily_count_reset_at` → `monthly_count_reset_at` in all mock data
- Change `expect(json.usage.limit).toBe(5)` → `expect(json.usage.limit).toBe(10)` for free user
- For the "resets count when reset date is in the past" test, use a date from last month instead of yesterday

**Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --reporter=verbose apps/server/src/routes/__tests__/usage.test.ts`
Expected: FAIL — field names don't match

**Step 3: Update usage route**

In `routes/usage.ts`:

- Change `user.daily_summary_count` → `user.monthly_summary_count`
- Change `user.daily_count_reset_at` → `user.monthly_count_reset_at`
- Change the reset check: instead of comparing to today, compare to first of current month:
  ```ts
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const used = user.monthly_count_reset_at < monthStartStr ? 0 : user.monthly_summary_count;
  ```
- `resetAt` should return `user.monthly_count_reset_at`

**Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --reporter=verbose apps/server/src/routes/__tests__/usage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/usage.ts apps/server/src/routes/__tests__/usage.test.ts
git commit -m "update usage route to monthly rate limits"
```

---

### Task 4: Update queue route and tests

**Files:**

- Modify: `apps/server/src/routes/queue.ts`
- Modify: `apps/server/src/routes/__tests__/queue.test.ts`

**Step 1: Update queue tests**

In `queue.test.ts`:

- In the batch 402 test, change mock data `daily_summary_count` → `monthly_summary_count`, `daily_count_reset_at` → `monthly_count_reset_at`
- The rate limit test for `POST /queue` should still work as-is (it mocks `rpc` directly)
- Update the RPC call name expectation if testing it: `increment_daily_count` → `increment_monthly_count`

**Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- --reporter=verbose apps/server/src/routes/__tests__/queue.test.ts`
Expected: FAIL

**Step 3: Update queue route**

In `routes/queue.ts`:

`POST /` handler:

- Change `supabase.rpc("increment_daily_count", ...)` → `supabase.rpc("increment_monthly_count", ...)`
- Change error message: `"Daily summary limit reached"` → `"Monthly summary limit reached"`

`POST /batch` handler:

- Change `user.daily_count_reset_at` → `user.monthly_count_reset_at`
- Change `user.daily_summary_count` → `user.monthly_summary_count`
- Change the reset check to compare against first of month instead of today:
  ```ts
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const currentUsed =
    (user.monthly_count_reset_at as string) < monthStartStr
      ? 0
      : (user.monthly_summary_count as number);
  ```
- Update the usage increment to write `monthly_summary_count` and `monthly_count_reset_at`
- Change error message: `"Daily summary limit reached"` → `"Monthly summary limit reached"`

**Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- --reporter=verbose apps/server/src/routes/__tests__/queue.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/queue.ts apps/server/src/routes/__tests__/queue.test.ts
git commit -m "update queue route to monthly rate limits"
```

---

### Task 5: Update extension UsageBar

**Files:**

- Modify: `apps/extension/components/UsageBar.tsx`

**Step 1: Update copy**

- `"No summaries left today"` → `"No summaries left this month"`
- `"${remaining} summaries left today"` → `"${remaining} summaries left this month"`
- `"Get 100/day with Pro"` → `"Get 100/mo with Pro"`

**Step 2: Build extension to verify**

Run: `pnpm --filter extension build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/extension/components/UsageBar.tsx
git commit -m "update UsageBar copy to monthly limits"
```

---

### Task 6: Run full test suite

**Step 1: Run all unit tests**

Run: `pnpm test:unit`
Expected: All tests pass

**Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors
