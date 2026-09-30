-- name: AddIssueMember :exec
INSERT INTO issue_member (issue_id, workspace_id, member_type, member_id, added_by_type, added_by_id)
VALUES (@issue_id, @workspace_id, @member_type, @member_id, sqlc.narg(added_by_type), sqlc.narg(added_by_id))
ON CONFLICT (issue_id, member_type, member_id) DO NOTHING;

-- name: RemoveIssueMember :execrows
DELETE FROM issue_member
WHERE issue_id = @issue_id
  AND workspace_id = @workspace_id
  AND member_type = @member_type
  AND member_id = @member_id;

-- name: ListIssueMembers :many
SELECT * FROM issue_member
WHERE issue_id = @issue_id AND workspace_id = @workspace_id
ORDER BY created_at ASC, member_type ASC, member_id ASC;

-- name: ListIssueMembersForIssues :many
SELECT * FROM issue_member
WHERE workspace_id = @workspace_id AND issue_id = ANY(@issue_ids::uuid[])
ORDER BY issue_id, created_at ASC, member_type ASC, member_id ASC;

-- name: IssueHasMembers :one
SELECT EXISTS (SELECT 1 FROM issue_member WHERE issue_id = @issue_id)::bool;

-- name: IsIssueMember :one
SELECT EXISTS (
    SELECT 1 FROM issue_member
    WHERE issue_id = @issue_id AND member_type = @member_type AND member_id = @member_id
)::bool;

-- name: ListGroupChatsForMember :many
-- Group chats the given person/agent belongs to: the ones they pinned first,
-- then newest message first. Chats without messages yet sort by their
-- creation time.
SELECT i.* FROM issue i
JOIN issue_member m
  ON m.issue_id = i.id
 AND m.workspace_id = i.workspace_id
 AND m.member_type = @member_type
 AND m.member_id = @member_id
WHERE i.workspace_id = @workspace_id
ORDER BY (m.pinned_at IS NOT NULL) DESC, COALESCE(i.last_comment_at, i.created_at) DESC, i.id DESC
LIMIT @row_limit;

-- name: SetIssueMemberPinned :execrows
-- Pins or unpins a chat for one of its members. Re-pinning keeps the original
-- pin time.
UPDATE issue_member
SET pinned_at = CASE WHEN @pinned::bool THEN COALESCE(pinned_at, now()) ELSE NULL END
WHERE issue_id = @issue_id
  AND workspace_id = @workspace_id
  AND member_type = @member_type
  AND member_id = @member_id;

-- name: MarkIssueDirectChat :exec
UPDATE issue SET is_direct_chat = true WHERE id = @id;

-- name: FindDirectGroupChat :one
-- The oldest direct chat between the given person and peer.
SELECT i.* FROM issue i
WHERE i.workspace_id = @workspace_id
  AND i.is_direct_chat
  AND EXISTS (
      SELECT 1 FROM issue_member m
      WHERE m.issue_id = i.id AND m.member_type = 'member' AND m.member_id = @user_id
  )
  AND EXISTS (
      SELECT 1 FROM issue_member m
      WHERE m.issue_id = i.id AND m.member_type = @peer_type AND m.member_id = @peer_id
  )
ORDER BY i.created_at ASC, i.id ASC
LIMIT 1;

-- name: ListLatestCommentsForIssues :many
SELECT DISTINCT ON (c.issue_id) c.*
FROM comment c
WHERE c.workspace_id = @workspace_id
  AND c.issue_id = ANY(@issue_ids::uuid[])
  AND c.deleted_at IS NULL
ORDER BY c.issue_id, c.created_at DESC, c.id DESC;

-- name: ListIssueHumanMemberUserIDs :many
-- Recipients for group chat realtime events.
SELECT member_id FROM issue_member
WHERE issue_id = @issue_id AND member_type = 'member';
