-- Expo push tokens, one row per device per user. The devices endpoint and the
-- push sender have used this table since they were written, but no migration
-- ever created it.

create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

-- Server-only (service role); no policies, so the anon and user keys see nothing.
alter table push_tokens enable row level security;
