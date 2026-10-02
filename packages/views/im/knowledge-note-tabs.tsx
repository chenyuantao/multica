"use client";

import { createContext, use, type ReactNode } from "react";

/** A knowledge note opened from a document card into the chat sidebar. */
export interface KnowledgeNoteTab {
  path: string;
  name: string;
}

export interface KnowledgeNoteTabs {
  notes: KnowledgeNoteTab[];
  /** `null` selects the chat details tab. */
  activePath: string | null;
}

export const EMPTY_KNOWLEDGE_NOTE_TABS: KnowledgeNoteTabs = { notes: [], activePath: null };

/** In-memory sidebar tabs, one set per chat. Not persisted. */
export type KnowledgeNoteTabsByChat = Readonly<Record<string, KnowledgeNoteTabs>>;

/** The tabs open in this chat. A chat with no memory shows details only. */
export function knowledgeNoteTabsFor(byChat: KnowledgeNoteTabsByChat, chatId: string | null): KnowledgeNoteTabs {
  if (!chatId) return EMPTY_KNOWLEDGE_NOTE_TABS;
  return byChat[chatId] ?? EMPTY_KNOWLEDGE_NOTE_TABS;
}

/** Updates one chat's tabs and leaves every other chat untouched. */
export function updateKnowledgeNoteTabs(
  byChat: KnowledgeNoteTabsByChat,
  chatId: string,
  update: (tabs: KnowledgeNoteTabs) => KnowledgeNoteTabs,
): KnowledgeNoteTabsByChat {
  const current = byChat[chatId] ?? EMPTY_KNOWLEDGE_NOTE_TABS;
  const next = update(current);
  if (next === current) return byChat;
  if (next.notes.length === 0) {
    if (byChat[chatId] == null) return byChat;
    const rest = { ...byChat };
    delete rest[chatId];
    return rest;
  }
  return { ...byChat, [chatId]: next };
}

/** Opens a note as a sidebar tab, or focuses it when it is already open. */
export function openKnowledgeNote(state: KnowledgeNoteTabs, note: KnowledgeNoteTab): KnowledgeNoteTabs {
  const notes = state.notes.some((item) => item.path === note.path)
    ? state.notes.map((item) => (item.path === note.path ? note : item))
    : [...state.notes, note];
  return { notes, activePath: note.path };
}

/** Closes a note tab. Closing the active one selects the note that slides into its place. */
export function closeKnowledgeNote(state: KnowledgeNoteTabs, path: string): KnowledgeNoteTabs {
  const index = state.notes.findIndex((item) => item.path === path);
  const notes = state.notes.filter((item) => item.path !== path);
  if (state.activePath !== path) return { notes, activePath: state.activePath };
  const next = notes[index] ?? notes[index - 1] ?? null;
  return { notes, activePath: next?.path ?? null };
}

const KnowledgeNotesContext = createContext<((note: KnowledgeNoteTab) => void) | null>(null);

export function KnowledgeNotesProvider({
  onOpen,
  children,
}: {
  onOpen: (note: KnowledgeNoteTab) => void;
  children: ReactNode;
}) {
  return <KnowledgeNotesContext value={onOpen}>{children}</KnowledgeNotesContext>;
}

/** Set inside a chat, so a document card opens in the sidebar instead of leaving the page. */
export function useOpenKnowledgeNote(): ((note: KnowledgeNoteTab) => void) | null {
  return use(KnowledgeNotesContext);
}
