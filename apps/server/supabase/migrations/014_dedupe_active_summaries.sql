-- Collapse accidental duplicate enqueues of the same video, while still
-- allowing a user to deliberately re-summarize a video later.
--
-- The application-level duplicate check in POST /api/queue is racy (TOCTOU):
-- concurrent requests — e.g. the OS share sheet firing the mobile handler 2-3×
-- before the share intent is reset — all pass the SELECT before any INSERT
-- lands, so every one of them inserts (observed: one video, 3 "completed" rows
-- created within 290ms).
--
-- Fix: a *time-windowed* atomic guard. Each insert carries a `dedup_bucket`
-- (unix-time / DEDUP_WINDOW_SECONDS, computed by the app). A partial unique
-- index on (user_id, youtube_video_id, dedup_bucket) makes concurrent inserts
-- in the same bucket collide — one writer wins, the rest get a unique violation
-- the handler turns into 409 DUPLICATE. Enqueues in a later bucket get a
-- different key and are allowed, so re-summarizing is not permanently blocked.
--
-- A time bucket can't be an index expression on created_at because
-- extract(epoch from timestamptz) is not IMMUTABLE, so the bucket is a plain
-- column the application fills in.
--
-- NOTE: the migration runner wraps this file in BEGIN/COMMIT — do not add your own.

-- 1. Collapse pre-existing duplicates so the queue isn't showing junk. Keep the
--    most-progressed row per (user, video) (completed > processing > pending),
--    tie-broken by earliest created_at; soft-delete the rest (consistent with
--    the existing deleted_at pattern).
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, youtube_video_id
      order by
        case status
          when 'completed'  then 0
          when 'processing' then 1
          when 'pending'    then 2
          else              3
        end,
        created_at asc
    ) as rn
  from public.summaries
  where status <> 'failed'
    and deleted_at is null
)
update public.summaries s
set deleted_at = now()
from ranked
where s.id = ranked.id
  and ranked.rn > 1;

-- 2. Bucket column the atomic guard keys on. NULL for existing rows (and so
--    excluded from the index below) — only new inserts carry a bucket.
alter table public.summaries
  add column dedup_bucket bigint;

comment on column public.summaries.dedup_bucket is
  'floor(unix_time / DEDUP_WINDOW_SECONDS) at insert. Backs the windowed '
  'duplicate-enqueue guard (summaries_user_video_bucket_uniq).';

-- 3. Atomic windowed dedup: at most one active row per (user, video) per bucket.
create unique index summaries_user_video_bucket_uniq
  on public.summaries (user_id, youtube_video_id, dedup_bucket)
  where status <> 'failed' and deleted_at is null and dedup_bucket is not null;
