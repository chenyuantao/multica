import type { Comment } from "./comment";

export type GroupChatMemberType = "member" | "agent";

export interface GroupChatMember {
  member_type: GroupChatMemberType;
  member_id: string;
  added_by_type: string | null;
  added_by_id: string | null;
  created_at: string;
}

/** An issue with members, presented as a group chat. Messages are its comments. */
export interface GroupChat {
  id: string;
  workspace_id: string;
  identifier: string;
  title: string;
  creator_type: string;
  creator_id: string;
  created_at: string;
  /** Time of the latest message; null until the first one. */
  last_comment_at: string | null;
  last_message: Comment | null;
  members: GroupChatMember[];
}

export interface GroupChatMemberRef {
  member_type: GroupChatMemberType;
  member_id: string;
}

export interface CreateGroupChatRequest {
  title: string;
  members: GroupChatMemberRef[];
}
