-- apps/server/supabase/migrations/042_coach_working_hours.sql
-- Creative coach 1b: working hours, the current focus, and progress photos.

alter table coach_settings
  -- Days of the week she works (0 = Sunday) and the local hours. Null until
  -- set: with no working hours there are no check-ins at all.
  add column if not exists work_days int[],
  add column if not exists work_start time,
  add column if not exists work_end time,
  -- What she last said she is working on. The strongest clue for filing.
  add column if not exists focus_project_id uuid references coach_projects(id) on delete set null,
  add column if not exists focus_set_at timestamptz;

create table if not exists coach_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Null while the bot is still asking which project it is for.
  project_id uuid references coach_projects(id) on delete set null,
  storage_path text not null,
  -- The same photo as a Library clip, tagged with its project.
  clip_id uuid references clips(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists coach_progress_project_idx
  on coach_progress (user_id, project_id, created_at desc);

alter table coach_progress enable row level security;
