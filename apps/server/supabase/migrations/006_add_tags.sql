alter table public.summaries add column tags text[] not null default '{}';
create index summaries_tags_idx on public.summaries using gin (tags);
comment on column public.summaries.tags is 'User-assigned tags for organizing summaries';
