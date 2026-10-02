-- The knowledge note open beside a group chat when a person sent a message.
-- The answering agent reads it with that message; people only see the message.
-- No foreign keys: comment, issue and workspace deletion sweep this table.
CREATE TABLE IF NOT EXISTS comment_focus_note (
    comment_id   UUID        PRIMARY KEY,
    issue_id     UUID        NOT NULL,
    workspace_id UUID        NOT NULL,
    name         TEXT        NOT NULL,
    path         TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
