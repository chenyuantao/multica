"use client";

import { createContext, use, useCallback, useRef, type ReactNode } from "react";
import type { DocExcerpt } from "./doc-excerpt";

type Insert = (excerpt: DocExcerpt) => void;

interface Registration {
  chatId: string;
  insert: Insert;
}

interface PendingExcerpt {
  chatId: string;
  excerpt: DocExcerpt;
}

const MAX_PENDING = 20;

const InsertContext = createContext<(chatId: string, excerpt: DocExcerpt) => boolean>(() => false);
const RegisterContext = createContext<(chatId: string, insert: Insert) => () => void>(() => () => {});

/**
 * Carries a selected passage from a sidebar note into the chat composer.
 * The note and the composer are siblings, and on a phone they are not mounted
 * together, so a click before the composer is open waits until that chat's
 * composer registers.
 */
export function DocExcerptInsertProvider({ children }: { children: ReactNode }) {
  const currentRef = useRef<Registration | null>(null);
  const pendingRef = useRef<PendingExcerpt[]>([]);

  const register = useCallback((chatId: string, insert: Insert) => {
    currentRef.current = { chatId, insert };
    const ready = pendingRef.current.filter((item) => item.chatId === chatId);
    pendingRef.current = pendingRef.current.filter((item) => item.chatId !== chatId);
    for (const item of ready) insert(item.excerpt);
    return () => {
      if (currentRef.current?.insert === insert) currentRef.current = null;
    };
  }, []);

  const insert = useCallback((chatId: string, excerpt: DocExcerpt) => {
    if (currentRef.current?.chatId === chatId) {
      currentRef.current.insert(excerpt);
      return true;
    }
    pendingRef.current = [...pendingRef.current, { chatId, excerpt }].slice(-MAX_PENDING);
    return false;
  }, []);

  return (
    <RegisterContext value={register}>
      <InsertContext value={insert}>{children}</InsertContext>
    </RegisterContext>
  );
}

/** True when the composer took the passage immediately. False when it is waiting for that chat's composer. */
export function useInsertDocExcerpt(): (chatId: string, excerpt: DocExcerpt) => boolean {
  return use(InsertContext);
}

export function useRegisterDocExcerptInsert(): (chatId: string, insert: Insert) => () => void {
  return use(RegisterContext);
}
