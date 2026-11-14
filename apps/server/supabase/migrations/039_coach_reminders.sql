-- apps/server/supabase/migrations/039_coach_reminders.sql
-- Creative coach, plan 2: reminders for dated tasks, and the per-user settings
-- that decide when they may fire.

create table if not exists coach_settings (
  user_id uuid primary key references users(id) on delete cascade,
  -- IANA name. Reminder times and "today" are computed in this zone. Null
  -- until the user's device reports one; no reminders are planned before then.
  timezone text,
  -- Nothing notifies between these local times (the window may cross midnight).
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  -- Weekly back-burner review: day of week (0 = Sunday) and local time.
  review_dow int not null default 0 check (review_dow between 0 and 6),
  review_time time not null default '18:00',
  last_review_at timestamptz,
  -- Consecutive reminders the phone never reported receiving. 2+ means
  -- notifications are not getting through.
  push_failures int not null default 0,
  last_delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists coach_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid not null references coach_tasks(id) on delete cascade,
  kind text not null check (kind in ('day_before', 'morning_of', 'at_time')),
  fire_at timestamptz not null,
  -- scheduled → sent → delivered (the phone said so) → acked (opened/answered).
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sent', 'delivered', 'acked', 'cancelled', 'expired')),
  sent_at timestamptz,
  delivered_at timestamptz,
  acked_at timestamptz,
  resends int not null default 0,
  created_at timestamptz not null default now(),
  unique (task_id, kind)
);

create index if not exists coach_reminders_due_idx on coach_reminders (status, fire_at);
create index if not exists coach_reminders_user_idx on coach_reminders (user_id, status);

-- Server uses the service role; no client-facing policies.
alter table coach_settings enable row level security;
alter table coach_reminders enable row level security;
