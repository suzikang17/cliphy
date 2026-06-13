alter table public.summaries add column user_notes text;
comment on column public.summaries.user_notes is
  'Freeform user notes attached to a summary, independent of the AI-generated summary_json';
