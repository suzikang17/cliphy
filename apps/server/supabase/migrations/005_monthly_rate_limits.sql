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
