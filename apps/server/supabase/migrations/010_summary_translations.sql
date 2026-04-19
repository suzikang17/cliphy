-- Cache generated translations on the summary row
-- translations is a JSONB map of { "es": SummaryJson, "fr": SummaryJson, ... }
alter table public.summaries
  add column translations jsonb not null default '{}'::jsonb;
