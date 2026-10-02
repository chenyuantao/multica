// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatDraftSummary, getChatDraft, setChatDraft, subscribeChatDrafts } from "./chat-draft";

const STORAGE_KEY = "multica:im-chat-drafts";

describe("chat drafts", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each chat's unsent text in localStorage until it is cleared", () => {
    setChatDraft("chat-1", "hold this");
    setChatDraft("chat-2", "other");
    expect(getChatDraft("chat-1")).toBe("hold this");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      "chat-1": "hold this",
      "chat-2": "other",
    });

    setChatDraft("chat-1", "");
    expect(getChatDraft("chat-1")).toBe("");
    expect(getChatDraft("chat-2")).toBe("other");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({ "chat-2": "other" });
  });

  it("reads a draft that was written directly to localStorage", () => {
    setChatDraft("chat-1", "stale");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "chat-1": "from another tab" }));
    expect(getChatDraft("chat-1")).toBe("from another tab");
  });

  it("drops a malformed store and ignores blank summaries", () => {
    localStorage.setItem(STORAGE_KEY, "{");
    expect(getChatDraft("chat-1")).toBe("");
    expect(chatDraftSummary("  line\n\nbreak  ")).toBe("line break");
    expect(chatDraftSummary("   ")).toBe("");
  });

  it("notifies subscribers when a draft changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeChatDrafts(listener);
    setChatDraft("chat-1", "hello");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    setChatDraft("chat-1", "again");
    expect(listener).toHaveBeenCalledOnce();
  });
});
