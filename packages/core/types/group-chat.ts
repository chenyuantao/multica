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

/** A chat whose messages contain the search keyword. */
export interface GroupChatSearchHit {
  chat_id: string;
  message_id: string;
  /** Excerpt of the newest matching message, as markdown. */
  snippet: string;
  message_at: string;
  /** Messages in the chat that contain the keyword. */
  hit_count: number;
}

export interface GroupChatSearchResult {
  query: string;
  hits: GroupChatSearchHit[];
}

/** A chat message the question is about; `text` is the part the person highlighted. */
export interface AskAISelection {
  message_id: string;
  time: string;
  sender: string;
  content: string;
  text?: string;
}

/**
 * The page a question was asked from: one of note, chat or contact, plus the
 * message picked on it. The planner and the answering agent both read it.
 */
export interface AskAIPage {
  note?: { title: string; path: string; modified_at: string; content: string; truncated: boolean };
  chat?: { title: string; agents: string[]; messages: { time: string; sender: string; content: string }[] };
  contact?: { type: GroupChatMemberType; name: string; description: string };
  selection?: AskAISelection;
}

export interface AskAIAttachment {
  name: string;
  content_type: string;
}

export interface AskAIRequest {
  query: string;
  page: AskAIPage | null;
  /** Names and types of the files sent with the question. */
  attachments?: AskAIAttachment[];
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
