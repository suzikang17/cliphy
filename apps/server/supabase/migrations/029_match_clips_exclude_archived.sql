-- apps/server/supabase/migrations/029_match_clips_exclude_archived.sql
-- Archived clips must not surface in semantic search or related-clips.
-- Recreate match_clips with an archived_at IS NULL filter (added after 026).

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
    and c.archived_at is null
    and c.status = 'completed'
    and c.embedding is not null
    and c.id <> exclude_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
