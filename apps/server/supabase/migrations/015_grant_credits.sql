-- Admin grants: two independent levers on top of the plan limit.
--   * monthly_limit_bonus — recurring. Added to the plan limit every month
--     (effective monthly cap = PLAN_LIMITS[plan] + monthly_limit_bonus).
--   * bonus_credits — one-off wallet. Carries over month to month and is only
--     consumed once the monthly allowance is exhausted. Never auto-resets.
alter table public.users
  add column if not exists monthly_limit_bonus integer not null default 0,
  add column if not exists bonus_credits integer not null default 0;

comment on column public.users.monthly_limit_bonus is
  'Recurring admin bonus added to the plan monthly limit. Effective cap = plan limit + this.';
comment on column public.users.bonus_credits is
  'One-off admin-granted credit wallet. Carries over months; spent only after the monthly allowance is used up.';

-- Single-consume: monthly allowance first, then the one-off wallet.
-- Caller passes p_limit = PLAN_LIMITS[plan] + monthly_limit_bonus (the effective
-- monthly cap). Returns true if a credit was consumed (monthly OR wallet), false
-- if both are exhausted. Resets the monthly counter lazily on a new month.
create or replace function public.increment_monthly_count(p_user_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  v_count integer;
  v_credits integer;
begin
  -- Lock the row; v_count is the effective current-month count (0 if stale month).
  select
    case
      when monthly_count_reset_at < date_trunc('month', current_date)::date then 0
      else monthly_summary_count
    end,
    bonus_credits
  into v_count, v_credits
  from public.users
  where id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  -- Within the monthly allowance (plan + recurring bonus): take a monthly slot.
  if v_count < p_limit then
    update public.users
    set monthly_summary_count = v_count + 1,
        monthly_count_reset_at = current_date
    where id = p_user_id;
    return true;
  end if;

  -- Monthly exhausted: draw from the one-off carry-over wallet.
  if v_credits > 0 then
    update public.users
    set bonus_credits = bonus_credits - 1,
        monthly_summary_count = v_count,        -- commit any lazy month reset
        monthly_count_reset_at = current_date
    where id = p_user_id;
    return true;
  end if;

  return false;
end;
$$;

comment on function public.increment_monthly_count is
  'Atomically consumes one summary credit: monthly allowance first, then the one-off bonus_credits wallet. Returns true if consumed, false if exhausted. Resets monthly count on a new month.';

-- Batch-consume: fill from the monthly allowance first, then top up from the
-- wallet for whatever the monthly allowance could not cover. Returns the total
-- number of credits actually consumed (0..p_count).
create or replace function public.increment_monthly_count_batch(
  p_user_id uuid, p_limit integer, p_count integer
)
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_current integer;
  v_credits integer;
  v_monthly integer;
  v_wallet integer;
  v_total integer;
begin
  select
    case
      when monthly_count_reset_at < date_trunc('month', current_date)::date then 0
      else monthly_summary_count
    end,
    bonus_credits
  into v_current, v_credits
  from public.users
  where id = p_user_id
  for update;

  if not found then
    return 0;
  end if;

  v_monthly := least(p_count, greatest(0, p_limit - v_current));
  v_wallet := least(p_count - v_monthly, v_credits);
  v_total := v_monthly + v_wallet;

  if v_total <= 0 then
    return 0;
  end if;

  update public.users
  set
    monthly_summary_count = v_current + v_monthly,
    bonus_credits = bonus_credits - v_wallet,
    monthly_count_reset_at = current_date
  where id = p_user_id;

  return v_total;
end;
$$;

comment on function public.increment_monthly_count_batch is
  'Atomically consumes up to p_count summary credits: monthly allowance first, then the one-off wallet. Returns the number actually consumed (0..p_count).';
