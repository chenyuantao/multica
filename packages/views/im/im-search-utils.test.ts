// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { DocNode, GroupChat, GroupChatSearchHit } from "@multica/core/types";
import { countMatches, rankChats, rankContacts, rankNotes } from "./im-search-utils";
import type { DirectoryEntry } from "./use-chat-directory";

const chat = (id: string, title: string, lastAt: string): GroupChat =>
  ({ id, title, created_at: "2026-01-01T00:00:00Z", last_comment_at: lastAt, members: [] }) as unknown as GroupChat;
const hit = (chatId: string, count: number): GroupChatSearchHit => ({
  chat_id: chatId,
  message_id: `m-${chatId}`,
  snippet: `snippet ${chatId}`,
  message_at: "",
  hit_count: count,
});

describe("countMatches", () => {
  it("counts case-insensitive, non-overlapping occurrences", () => {
    expect(countMatches("Alpha alpha ALPHA", "alpha")).toBe(3);
    expect(countMatches("aaaa", "aa")).toBe(2);
    expect(countMatches("anything", "")).toBe(0);
  });
});

describe("rankChats", () => {
  const chats = [
    chat("recent", "Weekly", "2026-03-01T00:00:00Z"),
    chat("older", "Weekly sync", "2026-02-01T00:00:00Z"),
    chat("busy", "Ops", "2026-01-01T00:00:00Z"),
    chat("titled", "Launch plan", "2026-01-02T00:00:00Z"),
    chat("none", "Quiet", "2026-04-01T00:00:00Z"),
  ];

  it("puts title matches first, then more hits, then recent activity", () => {
    const rows = rankChats(chats, [hit("busy", 5), hit("recent", 1), hit("older", 1)], "launch", (c) => c.title);
    expect(rows.map((r) => r.chat.id)).toEqual(["titled", "busy", "recent", "older"]);
    expect(rows[0]).toMatchObject({ titleMatch: true, snippet: "", hits: 1 });
    expect(rows[1]).toMatchObject({ titleMatch: false, snippet: "snippet busy", hits: 5 });
  });

  it("matches the shown title and drops hits for chats outside the list", () => {
    const rows = rankChats(chats, [hit("gone", 9)], "ada", (c) => (c.id === "none" ? "Ada" : c.title));
    expect(rows.map((r) => r.chat.id)).toEqual(["none"]);
  });
});

describe("rankContacts", () => {
  const entry = (id: string, name: string, detail: string): DirectoryEntry => ({ type: "agent", id, name, detail });

  it("puts name matches first, then more hits", () => {
    const rows = rankContacts(
      [
        entry("detail-twice", "Scout", "reviews code, then code again"),
        entry("detail-once", "Helper", "writes code"),
        entry("name", "Codex", ""),
        entry("miss", "Other", "nothing"),
      ],
      "code",
    );
    expect(rows.map((r) => r.entry.id)).toEqual(["name", "detail-twice", "detail-once"]);
  });
});

describe("rankNotes", () => {
  const note = (path: string, match: string, hits: number, modifiedAt: string | null): DocNode => ({
    name: path,
    path,
    type: "file",
    child_count: 0,
    modified_at: modifiedAt,
    children: [],
    match,
    snippet: "",
    hits,
  });

  it("puts title matches first, then more hits, then the latest edit", () => {
    const rows = rankNotes([
      note("body-new.md", "content", 2, "2026-03-01T00:00:00Z"),
      note("body-many.md", "content", 7, "2026-01-01T00:00:00Z"),
      note("title.md", "title", 1, null),
      note("body-old.md", "content", 2, "2026-02-01T00:00:00Z"),
    ]);
    expect(rows.map((n) => n.path)).toEqual(["title.md", "body-many.md", "body-new.md", "body-old.md"]);
  });
});
