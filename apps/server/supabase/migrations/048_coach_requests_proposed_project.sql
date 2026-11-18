-- A project the bot thinks a request belongs to but that does not exist yet.
-- Nothing is created from it: the owner is asked in Chat, and her answer
-- files every request waiting on that name.
alter table coach_requests
  add column if not exists proposed_project text;

create index if not exists coach_requests_proposed_project_idx
  on coach_requests (user_id, proposed_project)
  where proposed_project is not null;
