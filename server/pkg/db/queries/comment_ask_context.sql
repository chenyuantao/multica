-- name: CreateCommentAskContext :exec
INSERT INTO comment_ask_context (comment_id, issue_id, workspace_id, page)
VALUES ($1, $2, $3, $4)
ON CONFLICT (comment_id) DO NOTHING;

-- name: ListCommentAskContexts :many
SELECT comment_id, page
FROM comment_ask_context
WHERE workspace_id = @workspace_id
  AND comment_id = ANY(@comment_ids::uuid[]);

-- name: DeleteCommentAskContexts :exec
DELETE FROM comment_ask_context
WHERE workspace_id = @workspace_id
  AND comment_id = ANY(@comment_ids::uuid[]);
