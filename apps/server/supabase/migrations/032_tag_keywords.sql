-- apps/server/supabase/migrations/032_tag_keywords.sql
-- Per-tag keywords for the Tabs view: a deterministic "this text means this tag"
-- rule matched before any AI (e.g. project:lotus-bech ← "we curate life").

alter table tag_hints add column if not exists keywords text[] not null default '{}';
