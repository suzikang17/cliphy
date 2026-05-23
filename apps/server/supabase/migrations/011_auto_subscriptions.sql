-- ── Subscription type enum ─────────────────────────────────────────────────
create type public.subscription_type as enum ('channel', 'playlist', 'watch_later');

-- ── Subscriptions ──────────────────────────────────────────────────────────
create table public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  type            public.subscription_type not null,
  source_id       text,
  source_name     text not null,
  source_url      text,
  is_active       boolean not null default true,
  last_checked_at timestamptz,
  skipped_count   integer not null default 0,
  last_skipped_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function extensions.moddatetime(updated_at);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_active_idx on public.subscriptions(is_active) where is_active = true;

-- ── Seen videos (deduplication guard) ────────────────────────────────────
create table public.subscription_seen_videos (
  subscription_id  uuid not null references public.subscriptions(id) on delete cascade,
  youtube_video_id text not null,
  seen_at          timestamptz not null default now(),
  primary key (subscription_id, youtube_video_id)
);

create index subscription_seen_videos_sub_idx on public.subscription_seen_videos(subscription_id);

-- ── Google OAuth tokens (for Watch Later) ─────────────────────────────────
create table public.user_google_tokens (
  user_id       uuid primary key references public.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scopes        text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger user_google_tokens_updated_at
  before update on public.user_google_tokens
  for each row execute function extensions.moddatetime(updated_at);

-- ── OAuth state (CSRF prevention, 10-minute TTL) ───────────────────────────
create table public.oauth_states (
  state      text primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table public.subscriptions enable row level security;
alter table public.subscription_seen_videos enable row level security;
alter table public.user_google_tokens enable row level security;
alter table public.oauth_states enable row level security;

-- SELECT-only: all writes go through backend (service_role bypasses RLS)
create policy "subscriptions_select_own"
  on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_google_tokens_select_own"
  on public.user_google_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
