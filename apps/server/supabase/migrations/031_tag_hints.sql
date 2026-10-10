-- apps/server/supabase/migrations/031_tag_hints.sql
-- Per-tag free-text hints for the Tabs view organizer (e.g. client:acme →
-- "acme.com, #acme-eng, project Falcon"). Also the registry for tags that
-- exist before any clip uses them ("＋ Save as tag" on a proposed group).

create table if not exists tag_hints (
  user_id uuid not null references users(id) on delete cascade,
  tag text not null,
  hints text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);

-- Server uses the service role; no client-facing policies.
alter table tag_hints enable row level security;
