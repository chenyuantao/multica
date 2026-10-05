-- A person's saved copies of chat messages. The row stores the message
-- text itself (a single message, or a forwarded chat-history snapshot)
-- plus the chat and sender names at the moment it was saved, so the
-- favorite still reads after the chat is renamed or the person leaves.
-- No foreign keys: workspace teardown deletes these rows in application code.
CREATE TABLE IF NOT EXISTS message_collection (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    content TEXT NOT NULL,
    source_title TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
