-- Which app an account uses: the one it first showed up in, and the latest.
-- Read off request headers (services/clientKind.ts), so nothing has to ship
-- to the apps. Accounts older than this stay null in first_client: unknown.
alter table public.users
  add column if not exists first_client text,
  add column if not exists last_client text;

-- The hourly "this account is alive" touch, now also noting the app. One
-- statement, as before. first_client is only set within a day of sign-up, so
-- an old account is not labelled with whatever it happens to use today.
create or replace function public.touch_user(p_user_id uuid, p_client text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.users
  set last_active_at = now(),
      last_client = coalesce(p_client, last_client),
      first_client = coalesce(
        first_client,
        case when created_at > now() - interval '1 day' then p_client end
      )
  where id = p_user_id
    and (last_active_at is null or last_active_at < now() - interval '1 hour');
$$;

revoke all on function public.touch_user(uuid, text) from public, anon, authenticated;
grant execute on function public.touch_user(uuid, text) to service_role;
