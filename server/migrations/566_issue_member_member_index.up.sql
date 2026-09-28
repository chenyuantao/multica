-- Serves "which group chats is this person/agent in" for the chat list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_member_workspace_member
    ON issue_member (workspace_id, member_type, member_id);
