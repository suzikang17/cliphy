-- Pairing the Mac helper with an account: the Mac shows `code`, the owner types
-- it into the phone, and the Mac (holding the secret behind `poll_hash`)
-- collects an API key. Rows live for ten minutes and are deleted when used.

create table if not exists coach_pairings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  poll_hash text not null unique,
  user_id uuid references users(id) on delete cascade,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists coach_pairings_expires_idx on coach_pairings (expires_at);

-- Server-only (service role); no policies.
alter table coach_pairings enable row level security;
