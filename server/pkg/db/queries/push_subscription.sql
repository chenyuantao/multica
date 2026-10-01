-- name: UpsertPushSubscription :one
INSERT INTO push_subscription (user_id, platform, token, p256dh, auth, user_agent)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (platform, token)
DO UPDATE SET
    user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    updated_at = now()
RETURNING *;

-- name: DeletePushSubscriptionForUser :exec
DELETE FROM push_subscription
WHERE user_id = $1 AND platform = $2 AND token = $3;

-- name: ListPushSubscriptionsByUser :many
SELECT * FROM push_subscription
WHERE user_id = $1
ORDER BY created_at;

-- name: DeletePushSubscription :exec
DELETE FROM push_subscription
WHERE id = $1;
