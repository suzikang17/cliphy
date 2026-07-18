-- apps/server/supabase/migrations/023_podcast_feeds.sql

-- ── Podcast feeds ──────────────────────────────────────────────────────────
create table public.podcast_feeds (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  rss_url              text not null,
  title                text not null,
  author               text,
  artwork_url          text,
  auto_queue           boolean not null default true,
  min_duration_seconds integer,
  max_duration_seconds integer,
  last_polled_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger podcast_feeds_updated_at
  before update on public.podcast_feeds
  for each row execute function extensions.moddatetime(updated_at);

create index podcast_feeds_user_id_idx on public.podcast_feeds(user_id);

-- ── Podcast episodes ───────────────────────────────────────────────────────
create table public.podcast_episodes (
  id               uuid primary key default gen_random_uuid(),
  feed_id          uuid not null references public.podcast_feeds(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  guid             text not null,
  title            text not null,
  description      text,
  audio_url        text not null,
  artwork_url      text,
  duration_seconds integer,
  published_at     timestamptz not null,
  status           text not null default 'pending_approval'
                     check (status in ('pending_approval', 'queued', 'processing', 'done', 'skipped')),
  clip_id          uuid references public.clips(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger podcast_episodes_updated_at
  before update on public.podcast_episodes
  for each row execute function extensions.moddatetime(updated_at);

-- Dedup guard: one row per (user, episode guid)
create unique index podcast_episodes_user_guid_idx on public.podcast_episodes(user_id, guid);

create index podcast_episodes_feed_id_idx on public.podcast_episodes(feed_id);

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table public.podcast_feeds enable row level security;
alter table public.podcast_episodes enable row level security;

-- podcast_feeds policies
create policy "podcast_feeds_select_own"
  on public.podcast_feeds for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "podcast_feeds_insert_own"
  on public.podcast_feeds for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "podcast_feeds_update_own"
  on public.podcast_feeds for update to authenticated
  using ((select auth.uid()) = user_id);

create policy "podcast_feeds_delete_own"
  on public.podcast_feeds for delete to authenticated
  using ((select auth.uid()) = user_id);

-- podcast_episodes policies
create policy "podcast_episodes_select_own"
  on public.podcast_episodes for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "podcast_episodes_insert_own"
  on public.podcast_episodes for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "podcast_episodes_update_own"
  on public.podcast_episodes for update to authenticated
  using ((select auth.uid()) = user_id);

create policy "podcast_episodes_delete_own"
  on public.podcast_episodes for delete to authenticated
  using ((select auth.uid()) = user_id);
