-- The message a group chat message quotes. Agents receive the quoted message in
-- full with the quoting one. No foreign key: a quoted message may be deleted
-- later, and readers treat a missing target as gone.
--
-- Nullable with no default, so this is a metadata-only change. Bound lock
-- acquisition so it fails fast rather than queueing an ACCESS EXCLUSIVE lock in
-- front of every comment query.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE comment ADD COLUMN IF NOT EXISTS ref_message_id UUID NULL;
