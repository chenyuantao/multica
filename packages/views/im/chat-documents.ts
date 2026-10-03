import type { Comment } from "@multica/core/types";
import { parseObsidianNote, type ObsidianNote } from "../rich-content/obsidian-note";
import { parseChatHistory } from "./chat-history";

/** Rows kept in view; further documents scroll inside the section. */
export const VISIBLE_CHAT_DOCUMENTS = 3;

/** Fixed row height, so the list viewport is exactly three documents. */
export const CHAT_DOCUMENT_ROW_PX = 68;

export function chatDocumentListMaxPx(): number {
  return VISIBLE_CHAT_DOCUMENTS * CHAT_DOCUMENT_ROW_PX;
}

/** A knowledge-note card that showed up in the chat, kept once per path. */
export interface ChatDocument {
  note: ObsidianNote;
  /** When the newest message containing this note was sent. */
  appearedAt: string;
}

type ChatDocumentMessage = Pick<Comment, "id" | "content" | "created_at" | "type" | "deleted_at">;

const MAX_HISTORY_DEPTH = 8;

/**
 * Document cards from the chat, newest appearance first.
 * The same note path is listed once, using the card from its latest message.
 * A card inside a forwarded history counts as appearing when that history was sent.
 */
export function documentsInChat(messages: readonly ChatDocumentMessage[]): ChatDocument[] {
  const ordered = [...messages].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const byPath = new Map<string, ChatDocument>();
  for (const message of ordered) {
    if (message.deleted_at || message.type !== "comment") continue;
    for (const note of notesIn(message.content, 0)) {
      byPath.set(note.path, { note, appearedAt: message.created_at });
    }
  }
  return [...byPath.values()].sort(
    (a, b) => b.appearedAt.localeCompare(a.appearedAt) || a.note.path.localeCompare(b.note.path),
  );
}

function notesIn(content: string, depth: number): ObsidianNote[] {
  const notes: ObsidianNote[] = [];
  for (const match of content.matchAll(/```obsidian[^\n]*\r?\n([\s\S]*?)```/g)) {
    const note = parseObsidianNote(match[1] ?? "");
    if (note) notes.push(note);
  }
  if (depth >= MAX_HISTORY_DEPTH) return notes;
  const history = parseChatHistory(content);
  if (!history) return notes;
  for (const message of history.messages) notes.push(...notesIn(message.content, depth + 1));
  return notes;
}
