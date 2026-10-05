CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_collection_user_created
    ON message_collection (workspace_id, user_id, created_at DESC);
