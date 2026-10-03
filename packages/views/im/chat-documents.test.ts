// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Comment } from "@multica/core/types";
import { encodeChatHistory } from "./chat-history";
import { documentsInChat } from "./chat-documents";

function message(partial: Partial<Comment> & Pick<Comment, "id" | "content" | "created_at">): Comment {
  return {
    issue_id: "chat",
    author_type: "agent",
    author_id: "agent-1",
    type: "comment",
    parent_id: null,
    reactions: [],
    attachments: [],
    resolved_at: null,
    resolved_by_type: null,
    resolved_by_id: null,
    updated_at: partial.created_at,
    ...partial,
  };
}

function fence(note: { name: string; summary: string; path: string }): string {
  return "```obsidian\n" + JSON.stringify(note) + "\n```";
}

describe("documentsInChat", () => {
  it("keeps one card per path, newest appearance first, with that card's data", () => {
    const docs = documentsInChat([
      message({
        id: "m1",
        created_at: "2026-10-01T00:00:00Z",
        content: fence({ name: "周报", summary: "第一版", path: "Work/周报.md" }),
      }),
      message({
        id: "m2",
        created_at: "2026-10-03T00:00:00Z",
        content: fence({ name: "计划", summary: "本周", path: "Work/计划.md" }),
      }),
      message({
        id: "m3",
        created_at: "2026-10-02T00:00:00Z",
        content: "更新了\n\n" + fence({ name: "周报", summary: "已发布", path: "Work/周报.md" }),
      }),
    ]);

    expect(docs.map((doc) => [doc.note.path, doc.note.summary, doc.appearedAt])).toEqual([
      ["Work/计划.md", "本周", "2026-10-03T00:00:00Z"],
      ["Work/周报.md", "已发布", "2026-10-02T00:00:00Z"],
    ]);
  });

  it("ignores deleted messages, other comment types, file cards, and invalid fences", () => {
    const docs = documentsInChat([
      message({
        id: "gone",
        created_at: "2026-10-04T00:00:00Z",
        deleted_at: "2026-10-04T01:00:00Z",
        content: fence({ name: "已删", summary: "", path: "Work/已删.md" }),
      }),
      message({
        id: "system",
        created_at: "2026-10-04T00:00:00Z",
        type: "system",
        content: fence({ name: "系统", summary: "", path: "Work/系统.md" }),
      }),
      message({
        id: "file",
        created_at: "2026-10-04T00:00:00Z",
        content: "!file[spec.pdf](/uploads/spec.pdf)",
      }),
      message({
        id: "bad",
        created_at: "2026-10-04T00:00:00Z",
        content: "```obsidian\n{not json}\n```",
      }),
      message({
        id: "ok",
        created_at: "2026-10-01T00:00:00Z",
        content: fence({ name: "说明", summary: "还在", path: "Work/说明.md" }),
      }),
    ]);

    expect(docs.map((doc) => doc.note.path)).toEqual(["Work/说明.md"]);
  });

  it("counts a note inside forwarded history at the time the history was sent", () => {
    const content = encodeChatHistory({
      messages: [
        {
          author_name: "Ada",
          created_at: "2026-09-01T00:00:00Z",
          content: fence({ name: "规格", summary: "初稿", path: "Work/规格.md" }),
        },
      ],
    });
    const docs = documentsInChat([
      message({ id: "forward", created_at: "2026-10-02T08:00:00Z", content }),
      message({
        id: "later",
        created_at: "2026-10-02T09:00:00Z",
        content: fence({ name: "规格", summary: "定稿", path: "Work/规格.md" }),
      }),
    ]);

    expect(docs).toEqual([
      {
        note: { name: "规格", summary: "定稿", path: "Work/规格.md" },
        appearedAt: "2026-10-02T09:00:00Z",
      },
    ]);
  });
});
