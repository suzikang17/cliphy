-- apps/server/supabase/migrations/036_closed_groups.sql
-- What was open when a Tabs-view group was closed, so it can be resumed.
-- Address + title only. One row per user+group; a later close replaces it.
create table if not exists closed_groups (
  user_id   uuid not null references users(id) on delete cascade,
  group_key text not null,
  label     text not null,
  pages     jsonb not null default '[]',
  closed_at timestamptz not null default now(),
  primary key (user_id, group_key)
);
alter table closed_groups enable row level security;
