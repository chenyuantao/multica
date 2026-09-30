-- name: InsertDeliveredPrompt :exec
-- The latest successful claim replaces the row. A reclaimed task is handed
-- out again, and the copy last sent to the daemon is the one to show.
INSERT INTO task_delivered_prompt (task_id, prompt, truncated)
VALUES ($1, $2, $3)
ON CONFLICT (task_id) DO UPDATE
SET prompt = EXCLUDED.prompt,
    truncated = EXCLUDED.truncated;

-- name: GetDeliveredPrompt :one
SELECT prompt, truncated
FROM task_delivered_prompt
WHERE task_id = $1;
