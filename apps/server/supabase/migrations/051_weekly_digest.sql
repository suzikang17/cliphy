-- Weekly digest (ADR 0072): new uploads from the channels a person saves
-- from, the closest few summarized. Off unless the person turns it on.
alter table public.user_settings
  add column if not exists weekly_digest boolean not null default false;

create table if not exists public.digest_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  digest_date      date not null,
  youtube_video_id text not null,
  video_title      text not null,
  video_channel    text,
  published_at     timestamptz,
  -- How close it is to the person's clips (0 to 1), and to which clip.
  score            real not null,
  because_clip_id  uuid references public.clips(id) on delete set null,
  summary_json     jsonb not null,
  -- Set when the person keeps it: the clip it became.
  kept_clip_id     uuid references public.clips(id) on delete set null,
  dismissed_at     timestamptz,
  created_at       timestamptz not null default now(),
  -- A video is shown to a person once, ever.
  unique (user_id, youtube_video_id)
);

create index if not exists digest_items_user_date_idx
  on public.digest_items (user_id, digest_date desc);

alter table public.digest_items enable row level security;

-- SELECT-only: all writes go through the backend (service_role bypasses RLS)
drop policy if exists "digest_items_select_own" on public.digest_items;
create policy "digest_items_select_own"
  on public.digest_items for select to authenticated
  using ((select auth.uid()) = user_id);
