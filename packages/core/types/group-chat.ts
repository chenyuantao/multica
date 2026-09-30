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
  /** Chat announcement, stored as the issue description (markdown). */
  description: string;
  creator_type: string;
  creator_id: string;
  created_at: string;
  /** Time of the latest message; null until the first one. */
  last_comment_at: string | null;
  last_message: Comment | null;
  members: GroupChatMember[];
  /** Agents who have not finished speaking, in reply order. */
  pending_speakers: string[];
  /** Messages the current user has not read yet. */
  unread_count: number;
  /** Created as a two-person chat with one peer; its members never change. */
  is_direct: boolean;
  /** The current user pinned this chat to the top of their own list. */
  pinned: boolean;
}

export interface GroupChatMemberRef {
  member_type: GroupChatMemberType;
  member_id: string;
}

export interface UpdateGroupChatRequest {
  title?: string;
  description?: string;
}

export interface CreateGroupChatRequest {
  title: string;
  members: GroupChatMemberRef[];
}
