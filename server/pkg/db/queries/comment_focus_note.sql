-- name: CreateCommentFocusNote :exec
INSERT INTO comment_focus_note (comment_id, issue_id, workspace_id, name, path)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (comment_id) DO NOTHING;

-- name: ListCommentFocusNotes :many
SELECT comment_id, name, path
FROM comment_focus_note
WHERE workspace_id = @workspace_id
  AND comment_id = ANY(@comment_ids::uuid[]);

-- name: DeleteCommentFocusNotes :exec
DELETE FROM comment_focus_note
WHERE workspace_id = @workspace_id
  AND comment_id = ANY(@comment_ids::uuid[]);
