import type { DocNode, GroupChat, GroupChatSearchHit } from "@multica/core/types";
import { chatActivityAt } from "./im-utils";
import type { DirectoryEntry } from "./use-chat-directory";

export type SearchScope = "all" | "chats" | "contacts" | "notes";

/** Case-insensitive, non-overlapping occurrences of `query` in `text`. */
export function countMatches(text: string, query: string): number {
  const q = query.toLowerCase();
  if (!q) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  for (let at = haystack.indexOf(q); at >= 0; at = haystack.indexOf(q, at + q.length)) count++;
  return count;
}

export interface ChatSearchRow {
  chat: GroupChat;
  title: string;
  /** Excerpt of the newest matching message; empty when only the title matched. */
  snippet: string;
  hits: number;
  titleMatch: boolean;
}

/**
 * Chats whose shown title or messages contain `query`, one row per chat:
 * title matches first, then more hits, then the most recent activity.
 * Hits for chats outside `chats` are dropped.
 */
export function rankChats(
  chats: readonly GroupChat[],
  messageHits: readonly GroupChatSearchHit[],
  query: string,
  titleOf: (chat: GroupChat) => string,
): ChatSearchRow[] {
  const byChat = new Map(messageHits.map((hit) => [hit.chat_id, hit]));
  const rows: ChatSearchRow[] = [];
  for (const chat of chats) {
    const title = titleOf(chat);
    const titleHits = countMatches(title, query);
    const hit = byChat.get(chat.id);
    if (titleHits === 0 && !hit) continue;
    rows.push({
      chat,
      title,
      snippet: hit?.snippet ?? "",
      hits: titleHits + (hit?.hit_count ?? 0),
      titleMatch: titleHits > 0,
    });
  }
  return rows.sort(
    (a, b) =>
      Number(b.titleMatch) - Number(a.titleMatch) ||
      b.hits - a.hits ||
      chatActivityAt(b.chat).localeCompare(chatActivityAt(a.chat)),
  );
}

export interface ContactSearchRow {
  entry: DirectoryEntry;
  hits: number;
  nameMatch: boolean;
}

/** Contacts whose name or detail contains `query`: name matches first, then more hits. */
export function rankContacts(entries: readonly DirectoryEntry[], query: string): ContactSearchRow[] {
  const rows: ContactSearchRow[] = [];
  for (const entry of entries) {
    const nameHits = countMatches(entry.name, query);
    const hits = nameHits + countMatches(entry.detail, query);
    if (hits > 0) rows.push({ entry, hits, nameMatch: nameHits > 0 });
  }
  return rows.sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || b.hits - a.hits);
}

/** Note hits: title matches first, then more hits, then the most recently modified. */
export function rankNotes(notes: readonly DocNode[]): DocNode[] {
  const titleMatch = (node: DocNode) => Number(node.match === "title" || node.match === "both");
  const time = (node: DocNode) => (node.modified_at ? Date.parse(node.modified_at) || 0 : 0);
  return [...notes].sort((a, b) => titleMatch(b) - titleMatch(a) || b.hits - a.hits || time(b) - time(a));
}
