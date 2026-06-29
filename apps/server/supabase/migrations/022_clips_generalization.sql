-- apps/server/supabase/migrations/022_clips_generalization.sql

-- Enable pgvector (idempotent — safe to run even if already enabled)
create extension if not exists vector;

-- Make youtube_video_id nullable so non-YouTube clips can be inserted
alter table summaries
  alter column youtube_video_id drop not null;

-- Add universal columns
alter table summaries
  add column if not exists source_type    text not null default 'youtube',
  add column if not exists source_url     text,
  add column if not exists content        text,
  add column if not exists author         text,
  add column if not exists published_at   timestamptz,
  add column if not exists source_metadata jsonb,
  add column if not exists embedding      vector(1024);

-- Backfill existing YouTube rows
update summaries
set
  source_url = video_url,
  author     = video_channel
where source_type = 'youtube';

-- HNSW index for cosine similarity (works on partial data — null rows are excluded)
create index if not exists clips_embedding_idx
  on summaries using hnsw (embedding vector_cosine_ops);

-- Rename the table (FKs and RLS policies follow automatically in Postgres)
alter table summaries rename to clips;
