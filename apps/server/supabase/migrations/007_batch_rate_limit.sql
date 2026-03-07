-- Atomic batch rate limit increment for batch queue endpoint
create or replace function public.increment_monthly_count_batch(
  p_user_id uuid, p_limit integer, p_count integer
)
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_current integer;
  v_allowed integer;
begin
  -- Get current count, resetting if new month
  select
    case
      when monthly_count_reset_at < date_trunc('month', current_date)::date then 0
      else monthly_summary_count
    end
  into v_current
  from public.users
  where id = p_user_id
  for update;  -- row lock prevents concurrent reads

  if not found then
    return 0;
  end if;

  -- Calculate how many we can allow
  v_allowed := least(p_count, greatest(0, p_limit - v_current));

  if v_allowed <= 0 then
    return 0;
  end if;

  -- Atomic update
  update public.users
  set
    monthly_summary_count = v_current + v_allowed,
    monthly_count_reset_at = current_date
  where id = p_user_id;

  return v_allowed;
end;
$$;

comment on function public.increment_monthly_count_batch is
  'Atomically checks monthly rate limit and increments count by up to p_count. Returns number actually allowed (0 to p_count). Resets on new month.';
