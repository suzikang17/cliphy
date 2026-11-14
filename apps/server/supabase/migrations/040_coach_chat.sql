-- apps/server/supabase/migrations/040_coach_chat.sql
-- Creative coach, plan 3: the chat thread and what the bot has learned.

create table if not exists coach_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('bot', 'user')),
  text text not null default '',
  attachments jsonb not null default '[]',
  -- [{ label, action }]: what the user can tap. At most three.
  buttons jsonb not null default '[]',
  link jsonb,
  -- Index of the button tapped. Set once; guards against a second tap.
  chosen int,
  kind text not null,
  -- What this message is about (a request id, a reminder id, …). With kind,
  -- it is how the bot avoids saying the same thing twice.
  ref_id text,
  created_at timestamptz not null default now()
);

-- A plain (not partial) unique index, so an upsert can name it as its conflict
-- target. Rows with a null ref_id never conflict with each other.
create unique index if not exists coach_chat_once_idx
  on coach_chat_messages (user_id, kind, ref_id);
create index if not exists coach_chat_thread_idx on coach_chat_messages (user_id, created_at);

-- Plain sentences the bot applies before asking again. Nothing is learned
-- that is not a row here, and the user can edit or delete every row.
create table if not exists coach_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  sentence text not null,
  person_id uuid references coach_people(id) on delete set null,
  project_id uuid references coach_projects(id) on delete set null,
  active boolean not null default true,
  source_message_id uuid references coach_chat_messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists coach_rules_user_idx on coach_rules (user_id, active);

alter table coach_chat_messages enable row level security;
alter table coach_rules enable row level security;
