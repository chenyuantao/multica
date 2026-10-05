-- name: ListMessageCollections :many
SELECT id, workspace_id, user_id, content, source_title, sender_name, created_at
FROM message_collection
WHERE workspace_id = $1 AND user_id = $2
ORDER BY created_at DESC, id DESC;

-- name: CreateMessageCollection :one
INSERT INTO message_collection (workspace_id, user_id, content, source_title, sender_name)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, workspace_id, user_id, content, source_title, sender_name, created_at;

-- name: DeleteMessageCollection :execrows
DELETE FROM message_collection
WHERE id = $1 AND workspace_id = $2 AND user_id = $3;

-- name: DeleteMessageCollectionsByWorkspace :exec
DELETE FROM message_collection
WHERE workspace_id = $1;
