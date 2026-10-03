-- name: DeleteWechatClawLoginsForUser :exec
-- A user has at most one QR login in progress; a new QR retires the old one.
DELETE FROM wechat_claw_login WHERE user_id = @user_id;

-- name: CreateWechatClawLogin :exec
INSERT INTO wechat_claw_login (qrcode, user_id, workspace_id)
VALUES (@qrcode, @user_id, @workspace_id);

-- name: GetWechatClawLogin :one
SELECT * FROM wechat_claw_login
WHERE qrcode = @qrcode AND user_id = @user_id;

-- name: DeleteWechatClawLogin :exec
DELETE FROM wechat_claw_login WHERE qrcode = @qrcode;

-- name: UpsertWechatClawBinding :one
-- Binding again replaces the previous bot and workspace. The cursor, context
-- and lease belong to the old bot, so they start over.
INSERT INTO wechat_claw_binding (user_id, workspace_id, bot_token_encrypted, ilink_bot_id, ilink_user_id, base_url)
VALUES (@user_id, @workspace_id, @bot_token_encrypted, @ilink_bot_id, @ilink_user_id, @base_url)
ON CONFLICT (user_id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    bot_token_encrypted = EXCLUDED.bot_token_encrypted,
    ilink_bot_id = EXCLUDED.ilink_bot_id,
    ilink_user_id = EXCLUDED.ilink_user_id,
    base_url = EXCLUDED.base_url,
    sync_cursor = '',
    context_token = '',
    lease_token = '',
    lease_expires_at = NULL,
    created_at = now(),
    updated_at = now()
RETURNING *;

-- name: GetWechatClawBinding :one
SELECT * FROM wechat_claw_binding WHERE user_id = @user_id;

-- name: DeleteWechatClawBinding :exec
DELETE FROM wechat_claw_binding WHERE user_id = @user_id;

-- name: ListWechatClawBindings :many
SELECT * FROM wechat_claw_binding ORDER BY user_id;

-- name: AcquireWechatClawLease :one
-- Grants or renews the long-poll lease when it is free, expired, or already
-- held by this token. No row means another replica holds it, or the binding
-- was removed or replaced (a re-bind clears the lease, which drops the old
-- holder because its token no longer matches after another replica takes it).
UPDATE wechat_claw_binding SET
    lease_token = @lease_token,
    lease_expires_at = now() + make_interval(secs => @ttl_seconds::float8)
WHERE user_id = @user_id
  AND ilink_bot_id = @ilink_bot_id
  AND (lease_token = @lease_token OR lease_token = '' OR lease_expires_at IS NULL OR lease_expires_at < now())
RETURNING *;

-- name: ReleaseWechatClawLease :exec
UPDATE wechat_claw_binding SET lease_token = '', lease_expires_at = NULL
WHERE user_id = @user_id AND lease_token = @lease_token;

-- name: SetWechatClawSyncCursor :exec
-- Fenced by the lease so a replica that lost the lease cannot rewind the cursor.
UPDATE wechat_claw_binding SET sync_cursor = @sync_cursor, updated_at = now()
WHERE user_id = @user_id AND lease_token = @lease_token;

-- name: SetWechatClawContextToken :exec
UPDATE wechat_claw_binding SET context_token = @context_token, updated_at = now()
WHERE user_id = @user_id AND ilink_bot_id = @ilink_bot_id;
