-- apps/server/supabase/migrations/033_trail.sql
-- Trail: pages you closed, saved automatically (opt-in, extension-side) and kept
-- apart from clips. One row per (user, url); re-closing bumps closed_at/close_count.

create table if not exists trail_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  url text not null,
  title text not null default '',
  host text not null default '',
  tags text[] not null default '{}',
  opened_at timestamptz,
  closed_at timestamptz not null default now(),
  close_count integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists trail_items_user_closed_idx on trail_items (user_id, closed_at desc);

-- Server uses the service role; no client-facing policies.
alter table trail_items enable row level security;

-- Retention: null = keep forever (default).
alter table user_settings add column if not exists trail_retention_days integer;
