// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Comment, DocFile, GroupChat } from "@multica/core/types";
import { ASK_NOTE_MAX_CHARS, chatAskPage, contactAskPage, noteAskPage, visibleMessageIds } from "./ask-ai-context";
import { THINKING_MESSAGE } from "./im-utils";

describe("noteAskPage", () => {
  it("carries title, path, edit time and a body cut at 24k characters", () => {
    const file = { path: "a/计划.md", content: "字".repeat(ASK_NOTE_MAX_CHARS + 3), modified_at: "2026-01-01T00:00:00Z" } as DocFile;
    const { note } = noteAskPage("a/计划.md", file);
    expect(note).toMatchObject({ title: "计划", path: "a/计划.md", modified_at: "2026-01-01T00:00:00Z", truncated: true });
    expect(Array.from(note!.content)).toHaveLength(ASK_NOTE_MAX_CHARS);
  });

  it("keeps a short body whole", () => {
    expect(noteAskPage("x.md", { content: "hi", modified_at: "" } as DocFile).note).toMatchObject({ content: "hi", truncated: false });
  });
});

describe("chatAskPage", () => {
  const msg = (id: string, extra: Partial<Comment> = {}): Comment =>
    ({ id, author_type: "member", author_id: "u1", content: `text ${id}`, type: "comment", created_at: `t-${id}`, ...extra }) as Comment;

  it("lists the chat's agents and only the on-screen messages people can read", () => {
    const chat = {
      members: [
        { member_type: "member", member_id: "u1" },
        { member_type: "agent", member_id: "a1" },
      ],
    } as GroupChat;
    const messages = [
      msg("off"),
      msg("m1"),
      msg("sys", { type: "status_change" }),
      msg("wait", { author_type: "agent", author_id: "a1", content: THINKING_MESSAGE }),
      msg("m2", { author_type: "agent", author_id: "a1" }),
    ];
    const page = chatAskPage(chat, "Launch", messages, new Set(["m1", "sys", "wait", "m2"]), (type, id) => `${type}:${id}`);
    expect(page.chat).toEqual({
      title: "Launch",
      agents: ["agent:a1"],
      messages: [
        { time: "t-m1", sender: "member:u1", content: "text m1" },
        { time: "t-m2", sender: "agent:a1", content: "text m2" },
      ],
    });
  });
});

describe("contactAskPage", () => {
  it("carries the contact and its description", () => {
    expect(contactAskPage({ type: "agent", id: "a1", name: "Ops", detail: "Runs deploys" })).toEqual({
      contact: { type: "agent", name: "Ops", description: "Runs deploys" },
    });
  });
});

describe("visibleMessageIds", () => {
  it("keeps rows that overlap their scroll area", () => {
    document.body.innerHTML = `<div id="scroll" style="overflow-y:auto">
      <div data-message-id="above"></div><div data-message-id="in"></div><div data-message-id="below"></div>
    </div>`;
    const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top }) as DOMRect;
    const rects: Record<string, DOMRect> = { above: rect(0, 90), in: rect(150, 250), below: rect(420, 500) };
    document.getElementById("scroll")!.getBoundingClientRect = () => rect(100, 400);
    for (const el of document.querySelectorAll<HTMLElement>("[data-message-id]")) {
      el.getBoundingClientRect = () => rects[el.dataset.messageId!]!;
    }
    expect([...visibleMessageIds()]).toEqual(["in"]);
  });
});
