-- Add soft-delete support to summaries table

alter table public.summaries
  add column deleted_at timestamptz;

comment on column public.summaries.deleted_at is
  'Soft-delete timestamp. Non-null means the user deleted this summary from their dashboard.';

create index summaries_deleted_at_idx on public.summaries (deleted_at)
  where deleted_at is null;
