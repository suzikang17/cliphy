-- Batches: finished work for one client, checked item by item, then reported
-- to the client in one summary the owner sends herself.

create table if not exists coach_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  person_id uuid not null references coach_people(id) on delete cascade,
  project_id uuid references coach_projects(id) on delete set null,
  -- checking: items are being ticked. ready: the summary is written.
  status text not null default 'checking' check (status in ('checking', 'ready', 'sent')),
  summary text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- One thing the client asked for: a request, a message that never became
-- one, or a task the owner added by hand.
create table if not exists coach_batch_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  batch_id uuid not null references coach_batches(id) on delete cascade,
  request_id uuid references coach_requests(id) on delete cascade,
  message_id uuid references coach_messages(id) on delete cascade,
  task_id uuid references coach_tasks(id) on delete cascade,
  -- What was asked, as it read when the batch was made.
  label text not null,
  -- not_done leaves the request free to go into a later batch.
  state text not null default 'unchecked' check (state in ('unchecked', 'done', 'not_done')),
  note text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (num_nonnulls(request_id, message_id, task_id) = 1)
);

create index if not exists coach_batches_person_idx
  on coach_batches (user_id, person_id, created_at desc);
create index if not exists coach_batch_items_batch_idx on coach_batch_items (batch_id, position);
create index if not exists coach_batch_items_request_idx on coach_batch_items (user_id, request_id);

-- Messages the owner pulled into a task: what the client said about it.
create table if not exists coach_task_messages (
  task_id uuid not null references coach_tasks(id) on delete cascade,
  message_id uuid not null references coach_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, message_id)
);

-- Server uses the service role; no client-facing policies.
alter table coach_task_messages enable row level security;
alter table coach_batches enable row level security;
alter table coach_batch_items enable row level security;
