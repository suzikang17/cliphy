-- apps/server/supabase/migrations/037_tag_notes.sql
-- Your free-text note per tag group in the Tabs view (e.g. "invoice due Fri").
-- Separate from tag_hints, whose row is removed when hints + keywords are empty.

create table if not exists tag_notes (
  user_id    uuid not null references users(id) on delete cascade,
  tag        text not null,
  note       text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);
alter table tag_notes enable row level security;
