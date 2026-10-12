-- An agent handing todo work to another agent files a task group chat, the
-- current to-do, rather than a board issue. A constant default is a
-- metadata-only change. Bound lock acquisition so it fails fast rather than
-- queueing an ACCESS EXCLUSIVE lock in front of every issue query.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE issue ADD COLUMN IF NOT EXISTS is_task_chat BOOLEAN NOT NULL DEFAULT false;
