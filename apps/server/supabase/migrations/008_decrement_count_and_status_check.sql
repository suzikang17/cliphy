-- Decrement function for rolling back rate limit on insert failure
create or replace function public.decrement_monthly_count(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.users
  set monthly_summary_count = greatest(0, monthly_summary_count - 1)
  where id = p_user_id
    and monthly_count_reset_at >= date_trunc('month', current_date)::date;
end;
$$;

comment on function public.decrement_monthly_count is
  'Decrements monthly count by 1 (floor 0). Used to rollback on insert failure.';

-- Batch decrement for rolling back batch insert failures
create or replace function public.decrement_monthly_count_batch(p_user_id uuid, p_count integer)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.users
  set monthly_summary_count = greatest(0, monthly_summary_count - p_count)
  where id = p_user_id
    and monthly_count_reset_at >= date_trunc('month', current_date)::date;
end;
$$;

comment on function public.decrement_monthly_count_batch is
  'Decrements monthly count by N (floor 0). Used to rollback on batch insert failure.';

-- Constrain subscription_status to valid values
alter table public.users add constraint users_subscription_status_check
  check (subscription_status in ('none', 'active', 'trialing', 'past_due', 'canceled', 'unpaid'));
