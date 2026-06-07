-- 013_error_category.sql
-- Persist the classified failure category (network / billing / rate_limit / upstream /
-- parse_failure / no_captions / unknown) alongside error_message so the admin queue can
-- filter failures by type. Computed by the summarize worker's classifyError().
alter table public.summaries
  add column if not exists error_category text;
