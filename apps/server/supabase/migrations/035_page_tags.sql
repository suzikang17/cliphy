-- apps/server/supabase/migrations/035_page_tags.sql
-- Which group each page belongs to, per user — from the Tabs view. The AI's
-- answer (keyword/Jev/Claude) and your manual choice are kept apart, so
-- undoing a manual move falls back to the AI's answer. `url` is the
-- normalized page identity (@cliphy/shared normalizeUrl). Page text is never stored.

create table if not exists page_tags (
  user_id uuid not null references users(id) on delete cascade,
  url text not null,
  -- AI assignment: 'tag' | 'proposed' | 'none'
  ai_kind text check (ai_kind in ('tag', 'proposed', 'none')),
  ai_value text,
  ai_source text check (ai_source in ('keyword', 'jev', 'claude')),
  ai_at timestamptz,
  done boolean not null default false,
  -- Your manual choice, as a Tabs-view group key ('tag:x', 'site:host', 'proposed:x'); wins over ai_*.
  override text,
  updated_at timestamptz not null default now(),
  primary key (user_id, url)
);

-- Server uses the service role; no client-facing policies.
alter table page_tags enable row level security;
