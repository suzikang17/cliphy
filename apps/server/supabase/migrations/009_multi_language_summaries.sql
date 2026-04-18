-- Multi-language summary support

-- User settings table (1:1 with users)
create table public.user_settings (
  user_id           uuid primary key references public.users (id) on delete cascade,
  summary_language  text not null default 'en',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.user_settings is
  'Per-user preferences. 1:1 with users, created on first access via upsert.';

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row
  execute function extensions.moddatetime(updated_at);

-- RLS: users can read own settings, all writes go through backend
alter table public.user_settings enable row level security;

create policy "user_settings_select_own"
  on public.user_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Add summary_language to summaries (what language the summary was requested in)
alter table public.summaries
  add column summary_language text not null default 'en';

-- Add transcript_language to summaries (what language the original captions were in)
alter table public.summaries
  add column transcript_language text;

-- Migrate summary_cache to composite key (video_id + language)
alter table public.summary_cache
  drop constraint summary_cache_pkey;

alter table public.summary_cache
  add column summary_language text not null default 'en';

alter table public.summary_cache
  add primary key (youtube_video_id, summary_language);
