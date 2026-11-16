-- Website task runner: a run is one attempt at a website change for a task,
-- made by a runner (first a devbox) that claims it over the API.
-- Spec: docs/superpowers/specs/2026-11-14-website-task-runner-design.md

-- With a repo, a project's `do` tasks can be started on the site. The live
-- site address is used for the "before" picture.
alter table coach_projects
  add column if not exists repo text,
  add column if not exists site_url text;

-- A key with the runner scope is accepted only by the runner's own calls.
-- Null (every existing key) behaves exactly as before.
alter table public.api_keys
  add column if not exists scope text check (scope in ('runner'));

create table if not exists coach_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid not null references coach_tasks(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'working', 'done', 'failed', 'cancelled')),
  claimed_at timestamptz,
  -- When the runner last checked in. A working run that goes quiet is failed.
  seen_at timestamptz,
  note text,
  summary text,
  branch text,
  pr_url text,
  preview_url text,
  -- [{ label: before|after, width: phone|desktop, storagePath }]
  pictures jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- A task has at most one run that is waiting or working.
create unique index if not exists coach_runs_active_idx
  on coach_runs (task_id) where status in ('queued', 'working');
create index if not exists coach_runs_queue_idx on coach_runs (user_id, status, created_at);

-- Server uses the service role; no client-facing policies.
alter table coach_runs enable row level security;
