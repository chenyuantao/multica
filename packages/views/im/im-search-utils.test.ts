// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { DocNode, GroupChat, GroupChatSearchHit } from "@multica/core/types";
import type { MessageCollection } from "@multica/core/types";
import { countMatches, orderSearchSections, previewSearchRows, rankChats, rankContacts, rankFavorites, rankNotes } from "./im-search-utils";
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

describe("rankFavorites", () => {
  const saved = (id: string, content: string, source: string, sender: string, at: string): MessageCollection => ({
    id,
    workspace_id: "ws",
    content,
    source_title: source,
    sender_name: sender,
    created_at: at,
  });
  const items = [
    saved("body", "status\nlaunch launch", "Ops", "Bea", "2026-03-01T00:00:00Z"),
    saved("title", "Launch plan", "Quiet", "Cy", "2026-01-01T00:00:00Z"),
    saved("source", "notes", "Launch room", "Ada", "2026-04-01T00:00:00Z"),
    saved("miss", "nothing", "Elsewhere", "Dee", "2026-05-01T00:00:00Z"),
  ];

  it("puts the title match first, then more hits, then the newest save", () => {
    const rows = rankFavorites(
      items,
      "launch",
      (item) => item.content.split("\n")[0] ?? "",
      (item) => item.content,
    );
    expect(rows.map((row) => row.item.id)).toEqual(["title", "body", "source"]);
    expect(rows[0]?.titleMatch).toBe(true);
    expect(rows[2]?.titleMatch).toBe(false);
  });
});

describe("orderSearchSections", () => {
  it("keeps the requested section first and the others in their usual order", () => {
    expect(orderSearchSections("chats")).toEqual(["chats", "contacts", "notes", "favorites"]);
    expect(orderSearchSections("contacts")).toEqual(["contacts", "chats", "notes", "favorites"]);
    expect(orderSearchSections("notes")).toEqual(["notes", "chats", "contacts", "favorites"]);
    expect(orderSearchSections("favorites")).toEqual(["favorites", "chats", "contacts", "notes"]);
  });
});

describe("previewSearchRows", () => {
  const rows = ["a", "b", "c", "d", "e"];

  it("shows three rows and counts the rest until the section is expanded", () => {
    expect(previewSearchRows(rows, false)).toEqual({ visible: ["a", "b", "c"], hidden: 2 });
    expect(previewSearchRows(rows, true)).toEqual({ visible: rows, hidden: 0 });
    expect(previewSearchRows(["a", "b"], false)).toEqual({ visible: ["a", "b"], hidden: 0 });
  });
});
