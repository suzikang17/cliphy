-- apps/server/supabase/migrations/028_notes.sql
-- Daily notes as a clip source type: one note per user per day, appended to
-- through the day. Reuses the whole clip pipeline (inbox, tags, archive,
-- embeddings, semantic search) rather than introducing a parallel store.

alter table public.clips drop constraint if exists clips_source_type_check;
alter table public.clips
  add constraint clips_source_type_check
  check (source_type in ('youtube', 'tweet', 'podcast', 'web', 'image', 'note'));

-- The note's day, as a plain YYYY-MM-DD string in source_metadata. The client
-- sends its own local date, so "today" means the user's today, not the
-- server's — a note written at 11pm belongs to that evening, not to tomorrow.
--
-- Partial unique index enforces one note per user per day and makes the
-- find-or-create path safe against double-submits.
create unique index if not exists clips_daily_note_idx
  on public.clips (user_id, (source_metadata ->> 'noteDate'))
  where source_type = 'note' and deleted_at is null;
