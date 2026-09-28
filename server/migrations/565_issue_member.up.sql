-- Group chat membership. An issue with at least one issue_member row is a group
-- chat: only its members (people and agents) can see it and receive its
-- messages. The creator is inserted as the first member and is the only one who
-- can add or remove members.
--
-- No foreign keys: issue and workspace deletion are application-owned and sweep
-- this table explicitly (DeleteIssue, DeleteWorkspaceData).
CREATE TABLE IF NOT EXISTS issue_member (
    issue_id      UUID        NOT NULL,
    workspace_id  UUID        NOT NULL,
    member_type   TEXT        NOT NULL CHECK (member_type IN ('member', 'agent')),
    member_id     UUID        NOT NULL,
    added_by_type TEXT        CHECK (added_by_type IN ('member', 'agent')),
    added_by_id   UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, member_type, member_id)
);
