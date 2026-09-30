-- A direct chat is a group chat created for exactly one person or agent and the
-- requester. It keeps those two members for good: nobody can be added or
-- removed, and clients present it as a conversation with the other side.
--
-- A constant default is a metadata-only change. Bound lock acquisition so it
-- fails fast rather than queueing an ACCESS EXCLUSIVE lock in front of every
-- issue query.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE issue ADD COLUMN IF NOT EXISTS is_direct_chat BOOLEAN NOT NULL DEFAULT false;
