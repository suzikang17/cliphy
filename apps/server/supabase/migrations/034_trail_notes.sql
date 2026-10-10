-- apps/server/supabase/migrations/034_trail_notes.sql
-- Your own name and a quick note for a tab (set in the Tabs view) follow it
-- into the trail when it's closed.

alter table trail_items add column if not exists custom_title text;
alter table trail_items add column if not exists note text;
