-- Personal API keys (for the "Add to Cliphy" Apple Shortcut and other clients)
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  key_hash     text not null unique,   -- sha256 hex of the full plaintext key
  key_prefix   text not null,          -- first 14 chars, for display only
  name         text not null default 'Shortcut',
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index api_keys_user_id_idx on public.api_keys(user_id);

alter table public.api_keys enable row level security;

-- SELECT-only: all writes go through backend (service_role bypasses RLS)
create policy "api_keys_select_own"
  on public.api_keys for select to authenticated
  using ((select auth.uid()) = user_id);
