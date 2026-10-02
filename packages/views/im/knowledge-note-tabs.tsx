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
