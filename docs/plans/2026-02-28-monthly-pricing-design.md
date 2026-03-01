# Monthly Usage-Based Pricing Model

## Overview

Replace daily rate limits (5/day free, 100/day pro) with monthly limits (10/mo free, 100/mo pro).

## Pricing

| Tier | Limit               | Price |
| ---- | ------------------- | ----- |
| Free | 10 summaries/month  | $0    |
| Pro  | 100 summaries/month | $5/mo |

## Database Migration (`005_monthly_rate_limits.sql`)

Rename columns:

- `daily_summary_count` → `monthly_summary_count`
- `daily_count_reset_at` → `monthly_count_reset_at`

Replace `increment_daily_count()` with `increment_monthly_count(p_user_id, p_limit)`:

- Same atomic check-and-increment pattern
- Resets when `monthly_count_reset_at < date_trunc('month', current_date)`
- Sets `monthly_count_reset_at` to `date_trunc('month', current_date)` on reset

Update `handle_new_user()` trigger to default `monthly_count_reset_at` to `current_date`.

## Shared Package

`packages/shared/src/constants.ts`:

- `PLAN_LIMITS`: `{ free: 10, pro: 100 }`

`packages/shared/src/types.ts`:

- `User.dailySummaryCount` → `User.monthlySummaryCount`
- `User.dailyCountResetAt` → `User.monthlyCountResetAt`

## Server

`routes/queue.ts`:

- `POST /` — call `increment_monthly_count` instead of `increment_daily_count`
- `POST /batch` — calculate remaining capacity from monthly count
- Error messages: "Monthly summary limit reached"

`routes/usage.ts`:

- Return monthly used/limit
- `resetAt` = 1st of next month

## Extension

`components/UsageBar.tsx`:

- "X summaries left today" → "X summaries left this month"
- "Get 100/day with Pro" → "Get 100/mo with Pro"

## Files Touched

1. `apps/server/supabase/migrations/005_monthly_rate_limits.sql`
2. `packages/shared/src/constants.ts`
3. `packages/shared/src/types.ts`
4. `apps/server/src/routes/queue.ts`
5. `apps/server/src/routes/usage.ts`
6. `apps/extension/components/UsageBar.tsx`
