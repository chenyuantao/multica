CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS comment_client_id_uidx ON comment (workspace_id, issue_id, author_type, author_id, client_id) WHERE client_id IS NOT NULL;
