-- A person can pin a group chat to the top of their own chat list. The pin
-- lives on their membership row, so it is private to them and disappears when
-- they leave the chat.
--
-- A nullable column without a default is a metadata-only change. Bound lock
-- acquisition so it fails fast instead of queueing behind chat traffic.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE issue_member ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
