-- apps/server/supabase/migrations/027_pins_and_panels.sql
-- New tab pins & panels: triage/enrichment facts on clips, plus a placement
-- table recording what appears on the new tab and in what order.

-- Facts about what was done to a clip, and its triage state.
alter table public.clips
  add column if not exists enrichment_tier text not null default 'full'
    check (enrichment_tier in ('metadata','full')),
  add column if not exists archived_at timestamptz;

comment on column public.clips.enrichment_tier is
  'metadata = title/favicon/og:image + embedding, no Claude pass. full = enriched.';

create index if not exists clips_archived_at_idx
  on public.clips (archived_at) where archived_at is null;

-- Placement store. Holds no content — only what is pinned, and where.
create table if not exists public.pinned_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('clip','view')),
  layout     text not null default 'tile' check (layout in ('tile','panel')),
  position   int  not null,
  label      text,
  icon_url   text,
  clip_id    uuid references public.clips(id) on delete cascade,
  view_query jsonb,
  pinned_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pinned_items_target check (
    (kind = 'clip' and clip_id    is not null and view_query is null) or
    (kind = 'view' and view_query is not null and clip_id    is null)
  )
);

create index if not exists pinned_items_user_position_idx
  on public.pinned_items (user_id, position);
create unique index if not exists pinned_items_user_clip_idx
  on public.pinned_items (user_id, clip_id) where clip_id is not null;

-- RLS: select-only for the owner; writes go through the service role.
alter table public.pinned_items enable row level security;

drop policy if exists "pinned_items_select_own" on public.pinned_items;
create policy "pinned_items_select_own"
  on public.pinned_items for select to authenticated
  using (user_id = (select auth.uid()));
