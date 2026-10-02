"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "multica:im-chat-drafts";

export type ChatDraftMap = Readonly<Record<string, string>>;

const EMPTY: ChatDraftMap = {};
let snapshot: ChatDraftMap = EMPTY;
const listeners = new Set<() => void>();

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readDrafts(): ChatDraftMap {
  const store = getStorage();
  if (!store) return EMPTY;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY;
    const next: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) next[id] = value;
    }
    return Object.keys(next).length === 0 ? EMPTY : next;
  } catch {
    return EMPTY;
  }
}

function sameDrafts(a: ChatDraftMap, b: ChatDraftMap): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function publish(next: ChatDraftMap) {
  snapshot = next;
  const store = getStorage();
  if (store) {
    try {
      if (Object.keys(next).length === 0) store.removeItem(STORAGE_KEY);
      else store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode and quota failures leave the textarea as the live copy.
    }
  }
  for (const listener of listeners) listener();
}

/** One-line preview. A whitespace-only draft stays stored but does not replace the last message. */
export function chatDraftSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function getChatDraftSnapshot(): ChatDraftMap {
  const next = readDrafts();
  if (sameDrafts(snapshot, next)) return snapshot;
  snapshot = next;
  return snapshot;
}

export function getChatDraft(chatId: string): string {
  return getChatDraftSnapshot()[chatId] ?? "";
}

/** Empty text removes the draft. Anything else is kept until the user clears or sends it. */
export function setChatDraft(chatId: string, text: string): void {
  const current = getChatDraftSnapshot();
  if ((current[chatId] ?? "") === text) return;
  const next: Record<string, string> = { ...current };
  if (text.length === 0) delete next[chatId];
  else next[chatId] = text;
  publish(Object.keys(next).length === 0 ? EMPTY : next);
}

export function subscribeChatDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  snapshot = readDrafts();
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", onStorage);
}

export function useChatDraft(chatId: string): string {
  const drafts = useSyncExternalStore(subscribeChatDrafts, getChatDraftSnapshot, () => EMPTY);
  return drafts[chatId] ?? "";
}
