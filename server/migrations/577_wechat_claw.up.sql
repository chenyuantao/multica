-- WeChat Claw: each user may bind one personal WeChat iLink bot to exactly one
-- workspace. Messages the user sends to that bot are asked through Ask AI in
-- the bound workspace, and the answering agent's replies are copied back.
--
-- One row per user. bot_token_encrypted is secretbox ciphertext, never
-- plaintext. lease_token / lease_expires_at fence the long-poll loop so only
-- one replica consumes a bot's updates at a time; sync_cursor is the iLink
-- get_updates_buf that loop resumes from.
-- No foreign keys: workspace deletion sweeps this table.
CREATE TABLE IF NOT EXISTS wechat_claw_binding (
    user_id             UUID        PRIMARY KEY,
    workspace_id        UUID        NOT NULL,
    bot_token_encrypted TEXT        NOT NULL,
    ilink_bot_id        TEXT        NOT NULL,
    ilink_user_id       TEXT        NOT NULL DEFAULT '',
    base_url            TEXT        NOT NULL DEFAULT '',
    sync_cursor         TEXT        NOT NULL DEFAULT '',
    context_token       TEXT        NOT NULL DEFAULT '',
    lease_token         TEXT        NOT NULL DEFAULT '',
    lease_expires_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A QR login in progress. The status poll can land on any replica, so the
-- QR code and the workspace it will bind to live here until it is confirmed,
-- expired, or replaced by a newer QR for the same user.
CREATE TABLE IF NOT EXISTS wechat_claw_login (
    qrcode       TEXT        PRIMARY KEY,
    user_id      UUID        NOT NULL,
    workspace_id UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marks a comment that entered through an external channel on behalf of its
-- author ('wechat_claw'). Like via_plugin_id it has no request field, so a
-- member posting normally cannot forge it.
ALTER TABLE comment ADD COLUMN IF NOT EXISTS via_channel TEXT;
