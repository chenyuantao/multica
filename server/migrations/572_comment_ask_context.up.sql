-- The page a group chat message was asked from with Ask AI: the note, chat or
-- contact on screen and any message the person selected. The agent that
-- answers reads it with the message; people only see the message.
-- No foreign keys: comment, issue and workspace deletion sweep this table.
CREATE TABLE IF NOT EXISTS comment_ask_context (
    comment_id   UUID        PRIMARY KEY,
    issue_id     UUID        NOT NULL,
    workspace_id UUID        NOT NULL,
    page         JSONB       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
