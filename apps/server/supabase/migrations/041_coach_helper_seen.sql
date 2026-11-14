-- apps/server/supabase/migrations/041_coach_helper_seen.sql
-- Creative coach, plan 5: when the Mac helper last reported in, so Setup can
-- say whether message capture is running.

alter table coach_settings add column if not exists helper_seen_at timestamptz;
