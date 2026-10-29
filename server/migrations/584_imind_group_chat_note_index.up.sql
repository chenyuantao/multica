CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS imind_group_chat_note_uidx ON imind_group_chat (workspace_id, share_root_id, note_id);
