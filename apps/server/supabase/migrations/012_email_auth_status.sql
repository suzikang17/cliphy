-- 012_email_auth_status.sql
-- Classifies an email for the email-first auth flow.
--   'new'      → no account with this email
--   'password' → account has an email/password identity (password login allowed)
--   'google'   → account exists but only via OAuth (e.g. Google)
create or replace function public.email_auth_status(p_email text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_has_password boolean;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;

  if v_user_id is null then
    return 'new';
  end if;

  select exists(
    select 1 from auth.identities
    where user_id = v_user_id and provider = 'email'
  ) into v_has_password;

  return case when v_has_password then 'password' else 'google' end;
end;
$$;

revoke all on function public.email_auth_status(text) from public, anon, authenticated;
grant execute on function public.email_auth_status(text) to service_role;
