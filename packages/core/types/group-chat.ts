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
  /** A to-do that also appears in the chat list because it has messages. */
  task: boolean;
  /** Issue status. Task chats use `done` once checked off; anything else is open. */
  status: string;
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

/** The URL path and query parameters of a page. */
export interface AskAILocation {
  path: string;
  params: Record<string, string>;
}

/** A DOM node picked on the page, with the URL path and query parameters of that page. */
export interface AskAIElement extends AskAILocation {
  tag: string;
  selector: string;
  attributes: Record<string, string>;
  html: string;
  text: string;
  images: { src: string; alt: string }[];
  /** `html` or `text` was cut short. */
  truncated: boolean;
}

/**
 * The page a question was asked from: one of note, chat or contact, or just
 * the location for pages without a richer description (Settings), plus the
 * message and the element picked on it. The planner and the answering agent
 * both read it.
 */
export interface AskAIPage {
  note?: { title: string; path: string; modified_at: string; content: string; truncated: boolean };
  chat?: { title: string; agents: string[]; messages: { id?: string; time: string; sender: string; content: string }[] };
  contact?: { type: GroupChatMemberType; name: string; description: string };
  location?: AskAILocation;
  selection?: AskAISelection;
  element?: AskAIElement;
}

/** The knowledge note open beside the chat when a message is sent. */
export interface FocusNote {
  name: string;
  path: string;
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

/**
 * A personal to-do kept as a group chat. It stays off the chat list until it
 * has a message, then appears there as a task chat. Its messages are the
 * details; an agent joins when the title or a message mentions it. A title
 * mention assigns the agent without another message.
 */
export interface Reminder extends GroupChat {
  /** `done` once checked off; anything else is open. */
  status: string;
  /** YYYY-MM-DD, or null when the reminder has no day. */
  due_date: string | null;
  /** Order among the open reminders of the same day; smaller sorts first. */
  position: number;
  updated_at: string;
  /** Pinned above the days until it is done, whatever its due date. */
  pending: boolean;
}

export interface CreateReminderRequest {
  title: string;
  due_date?: string | null;
  position?: number;
}

/** Fields a reminder row edits in place. */
export interface ReminderPatch {
  title?: string;
  due_date?: string | null;
  position?: number;
  done?: boolean;
}

export interface ListRemindersParams {
  /** Inclusive YYYY-MM-DD window on the due date. */
  from?: string;
  to?: string;
  status?: "open" | "done";
}

/** A saved copy of one message, or of several messages stored as a chat-history snapshot. */
export interface MessageCollection {
  id: string;
  workspace_id: string;
  content: string;
  source_title: string;
  sender_name: string;
  created_at: string;
}

export interface CreateMessageCollectionRequest {
  content: string;
  source_title: string;
  sender_name: string;
}
