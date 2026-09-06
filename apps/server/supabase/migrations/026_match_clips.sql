-- apps/server/supabase/migrations/026_match_clips.sql
-- Semantic search + related clips: a pgvector similarity function over the
-- existing 1024-dim cosine embedding column.

-- Ensure the HNSW cosine index exists on the current `clips` table (migration
-- 022 created it against the pre-rename `summaries` name).
create index if not exists clips_embedding_idx
  on public.clips using hnsw (embedding vector_cosine_ops);

create or replace function match_clips(
  query_embedding vector(1024),
  match_user_id uuid,
  exclude_id uuid,
  match_count int
)
returns table (id uuid, similarity float)
language sql stable
as $$
  select c.id, 1 - (c.embedding <=> query_embedding) as similarity
  from public.clips c
  where c.user_id = match_user_id
    and c.deleted_at is null
    and c.status = 'completed'
    and c.embedding is not null
    and c.id <> exclude_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
