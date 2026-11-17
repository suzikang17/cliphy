-- The owner's own tick on a message: "dealt with", whether or not it ever
-- became a request or went into a batch. Her thread is her checklist.
alter table coach_messages
  add column if not exists handled_at timestamptz;
