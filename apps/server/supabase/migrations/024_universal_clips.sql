-- apps/server/supabase/migrations/024_universal_clips.sql
-- Universal clip capture: add `web` source type + card display columns.

-- Add a source_type check constraint (none existed — column was freeform text).
-- All existing rows are youtube | tweet | podcast, so validation passes.
alter table public.clips drop constraint if exists clips_source_type_check;
alter table public.clips
  add constraint clips_source_type_check
  check (source_type in ('youtube', 'tweet', 'podcast', 'web'));

-- Card/display + triage columns (all nullable — existing rows stay valid).
alter table public.clips add column if not exists category       text;
alter table public.clips add column if not exists hero_image_url text;
alter table public.clips add column if not exists excerpt        text;

-- Inbox filtering by category.
create index if not exists clips_category_idx on public.clips(category);
