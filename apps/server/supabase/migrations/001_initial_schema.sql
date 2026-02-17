-- Cliphy initial schema
-- Run in Supabase SQL Editor (or via supabase db push)

-- ============================================================
-- Extensions
-- ============================================================

create extension if not exists moddatetime schema extensions;

-- ============================================================
-- Enum types
-- ============================================================

create type public.plan_tier as enum ('free', 'pro');
create type public.summary_status as enum ('pending', 'processing', 'completed', 'failed');

-- ============================================================
-- Users
-- ============================================================

create table public.users (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null,
  plan                 public.plan_tier not null default 'free',
  stripe_customer_id   text unique,
  daily_summary_count  integer not null default 0,
  daily_count_reset_at date not null default current_date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.users is
  'Application user profile, linked 1:1 to auth.users.';
comment on column public.users.daily_summary_count is
  'Number of summaries requested today. Reset when daily_count_reset_at < current_date.';
comment on column public.users.daily_count_reset_at is
  'Date the daily_summary_count was last reset. Compared to current_date to decide whether to reset.';

create trigger users_updated_at
  before update on public.users
  for each row
  execute function extensions.moddatetime(updated_at);

-- ============================================================
-- Summaries (unified queue + result table)
-- ============================================================

create table public.summaries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  youtube_video_id text not null,
  video_title      text,
  video_url        text,
  status           public.summary_status not null default 'pending',
  summary_json     jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.summaries is
  'YouTube video summaries requested by users. Tracks queue lifecycle and stores AI-generated content.';
comment on column public.summaries.summary_json is
  'AI-generated summary: { tldr, key_points[], timestamps[] }. JSONB for schema flexibility.';
comment on column public.summaries.error_message is
  'Populated when status = failed. Helps debugging without checking logs.';

create trigger summaries_updated_at
  before update on public.summaries
  for each row
  execute function extensions.moddatetime(updated_at);

create index summaries_user_id_idx on public.summaries (user_id);
create index summaries_youtube_video_id_idx on public.summaries (youtube_video_id);
create index summaries_status_idx on public.summaries (status);
create index summaries_user_id_created_at_idx on public.summaries (user_id, created_at desc);

-- ============================================================
-- Summary cache (shared across users)
-- ============================================================

create table public.summary_cache (
  youtube_video_id text primary key,
  video_title      text,
  summary_json     jsonb not null,
  hit_count        integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.summary_cache is
  'Cache of completed summaries keyed by video ID. Saves AI calls for popular videos.';
comment on column public.summary_cache.hit_count is
  'Number of times this cached summary has been served.';

create trigger summary_cache_updated_at
  before update on public.summary_cache
  for each row
  execute function extensions.moddatetime(updated_at);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.users enable row level security;
alter table public.summaries enable row level security;
alter table public.summary_cache enable row level security;

-- Users: SELECT only. No UPDATE/INSERT/DELETE policies.
-- All user mutations go through backend (service_role bypasses RLS).
-- This prevents plan escalation, rate limit reset, and stripe_customer_id spoofing.
create policy "users_select_own"
  on public.users
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- Summaries: SELECT only. No INSERT/UPDATE/DELETE policies.
-- All writes go through backend (service_role bypasses RLS).
create policy "summaries_select_own"
  on public.summaries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Cache: readable by any authenticated user (shared data, intentional).
-- No write policies — only backend (service_role) writes.
create policy "summary_cache_select_authenticated"
  on public.summary_cache
  for select
  to authenticated
  using (true);

-- ============================================================
-- Atomic rate-limit check-and-increment (prevents TOCTOU race)
-- ============================================================

create or replace function public.increment_daily_count(p_user_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.users
  set
    daily_summary_count = case
      when daily_count_reset_at < current_date then 1
      else daily_summary_count + 1
    end,
    daily_count_reset_at = current_date
  where id = p_user_id
    and (
      daily_count_reset_at < current_date  -- new day, reset
      or daily_summary_count < p_limit     -- under limit
    )
  returning daily_summary_count into v_count;

  return v_count is not null;
end;
$$;

comment on function public.increment_daily_count is
  'Atomically checks rate limit and increments daily count. Returns true if under limit, false if at/over. Resets on new day.';

-- ============================================================
-- Auth trigger: auto-create public.users on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (
    new.id,
    coalesce(new.email, new.raw_user_meta_data ->> 'email', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
