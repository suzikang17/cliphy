-- apps/server/supabase/migrations/030_clips_suggested_tags.sql
-- New tags proposed by auto-tagging (Claude topics that matched no existing tag),
-- shown as accept/dismiss chips. Accepted → moved into tags; dismissed → removed.

alter table clips add column if not exists suggested_tags text[] not null default '{}';
