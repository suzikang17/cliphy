-- Voice notes: a recording saved as a clip. Its words (the transcript) go in
-- `content` once it has been transcribed, and it is tagged like any other clip.
alter table public.clips drop constraint if exists clips_source_type_check;
alter table public.clips
  add constraint clips_source_type_check
  check (source_type in ('youtube', 'tweet', 'podcast', 'web', 'image', 'note', 'voice'));
