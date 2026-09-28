-- Group chats (issues surfaced under /im) sort and display by the time of their
-- latest comment. last_activity_at also moves on status and field edits, so it
-- cannot answer "when was the last message".
ALTER TABLE issue
    ADD COLUMN IF NOT EXISTS last_comment_at TIMESTAMPTZ;

UPDATE issue i
SET last_comment_at = c.max_created_at
FROM (
    SELECT issue_id, MAX(created_at) AS max_created_at
    FROM comment
    WHERE deleted_at IS NULL
    GROUP BY issue_id
) c
WHERE c.issue_id = i.id
  AND i.last_comment_at IS NULL;
