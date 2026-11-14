-- apps/server/supabase/migrations/038_coach_core.sql
-- Creative coach, build 1a: people, projects, captured messages grouped into
-- bundles, requests (with replace-history) and tasks of four kinds.
-- Spec: docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md

-- Per-account switch. Every /coach/* route checks it.
alter table public.users add column if not exists coach_enabled boolean not null default false;

create table if not exists coach_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  -- A label only in build 1: no behaviour branches on it.
  role text not null check (role in ('client', 'collaborator', 'both')),
  -- Phone numbers / emails that identify this person's message thread.
  handles text[] not null default '{}',
  capture_thread boolean not null default false,
  -- How far back to read when the thread is first connected, chosen per person.
  history_window text not null default 'new' check (history_window in ('new', 'window', 'all')),
  history_days int,
  created_at timestamptz not null default now()
);

create table if not exists coach_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  -- Tied to one existing `project:<slug>` tag so there is one notion of project.
  tag text not null,
  active boolean not null default true,
  state_line text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, tag)
);

create table if not exists coach_project_people (
  project_id uuid not null references coach_projects(id) on delete cascade,
  person_id uuid not null references coach_people(id) on delete cascade,
  primary key (project_id, person_id)
);

-- Messages from one person arriving close together are one bundle.
create table if not exists coach_bundles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  person_id uuid not null references coach_people(id) on delete cascade,
  status text not null default 'collecting'
    check (status in ('collecting', 'processing', 'done', 'failed')),
  kind text check (kind in ('request', 'reply', 'chat')),
  last_message_at timestamptz not null,
  -- Read from a thread's past: becomes history, never a new request.
  historical boolean not null default false,
  fix_note text,
  -- Times the read job has given up on this bundle; the sweep stops retrying at 3.
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  person_id uuid not null references coach_people(id) on delete cascade,
  bundle_id uuid references coach_bundles(id) on delete set null,
  channel text not null check (channel in ('imessage', 'sms', 'share')),
  direction text not null check (direction in ('in', 'out')),
  -- The source's own id for the message; makes re-uploads idempotent.
  external_id text not null,
  text text not null default '',
  attachments jsonb not null default '[]',
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, channel, external_id)
);

create table if not exists coach_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  bundle_id uuid not null references coach_bundles(id) on delete cascade,
  person_id uuid not null references coach_people(id) on delete cascade,
  project_id uuid references coach_projects(id) on delete set null,
  understood text not null,
  open_question jsonb,
  answer text,
  status text not null default 'new' check (status in ('new', 'confirmed', 'replaced', 'closed')),
  -- Nothing is deleted when a request is replaced: the old row stays, marked.
  replaces_id uuid references coach_requests(id) on delete set null,
  proposed_replaces_id uuid references coach_requests(id) on delete set null,
  proposed_tasks jsonb not null default '[]',
  due_date date,
  historical boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bundle_id)
);

create table if not exists coach_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  request_id uuid references coach_requests(id) on delete set null,
  project_id uuid references coach_projects(id) on delete set null,
  kind text not null check (kind in ('do', 'tell', 'ask', 'get')),
  state text not null default 'open' check (state in ('open', 'waiting', 'done', 'dropped')),
  title text not null,
  kit jsonb not null default '{}',
  with_person_id uuid references coach_people(id) on delete set null,
  -- Blocked until this task is done or dropped. Blocked is computed, not stored.
  after_task_id uuid references coach_tasks(id) on delete set null,
  due_date date,
  due_time time,
  place text,
  checklist jsonb not null default '[]',
  reply_bundle_id uuid references coach_bundles(id) on delete set null,
  position int not null default 0,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coach_messages_bundle_idx on coach_messages (bundle_id);
create index if not exists coach_bundles_person_idx on coach_bundles (user_id, person_id, status);
create index if not exists coach_requests_project_idx
  on coach_requests (user_id, project_id, created_at desc);
create index if not exists coach_tasks_state_idx on coach_tasks (user_id, state);

-- Server uses the service role; no client-facing policies.
alter table coach_people enable row level security;
alter table coach_projects enable row level security;
alter table coach_project_people enable row level security;
alter table coach_bundles enable row level security;
alter table coach_messages enable row level security;
alter table coach_requests enable row level security;
alter table coach_tasks enable row level security;
