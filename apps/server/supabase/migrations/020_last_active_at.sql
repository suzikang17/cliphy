-- Coarse user-activity signal (touched at most hourly by authMiddleware).
-- Drives subscription-poll backoff: dormant users' subscriptions poll daily
-- instead of every 15 minutes to conserve YouTube API quota.
alter table public.users
  add column last_active_at timestamptz;
