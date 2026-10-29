CREATE TABLE imind_group_chat (
    workspace_id UUID NOT NULL,
    share_root_id TEXT NOT NULL,
    share_machine TEXT NOT NULL,
    note_id UUID NOT NULL,
    issue_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workspace ADD COLUMN imind_default_agent_id UUID;
