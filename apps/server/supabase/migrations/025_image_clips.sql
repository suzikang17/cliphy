-- apps/server/supabase/migrations/025_image_clips.sql
-- Image / screenshot capture: allow the `image` source type and add a private
-- Storage bucket for captured images with per-user RLS.

-- Extend the source_type check constraint to include 'image'.
alter table public.clips drop constraint if exists clips_source_type_check;
alter table public.clips
  add constraint clips_source_type_check
  check (source_type in ('youtube', 'tweet', 'podcast', 'web', 'image'));

-- Private bucket for captured images.
insert into storage.buckets (id, name, public)
values ('clip-images', 'clip-images', false)
on conflict (id) do nothing;

-- RLS: a user may read/write/delete only under their own <userId>/ folder.
-- storage.foldername(name)[1] is the first path segment (the user id).
create policy "clip_images_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'clip-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "clip_images_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'clip-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "clip_images_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'clip-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
