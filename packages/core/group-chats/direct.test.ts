// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GroupChat, GroupChatMember } from "../types";
import { directChatPeer, findDirectChat } from "./direct";

const member = (member_type: GroupChatMember["member_type"], member_id: string): GroupChatMember => ({
  member_type,
  member_id,
  added_by_type: null,
  added_by_id: null,
  created_at: "2026-01-01T00:00:00Z",
});

const chat = (id: string, members: GroupChatMember[], opts: { direct?: boolean; created_at?: string } = {}): GroupChat => ({
  id,
  workspace_id: "ws-1",
  identifier: id,
  title: id,
  description: "",
  creator_type: "member",
  creator_id: "me",
  created_at: opts.created_at ?? "2026-01-01T00:00:00Z",
  last_comment_at: null,
  last_message: null,
  members,
  pending_speakers: [],
  unread_count: 0,
  is_direct: opts.direct ?? true,
});

describe("directChatPeer", () => {
  it("returns the other side of a direct chat the user is in", () => {
    expect(directChatPeer(chat("a", [member("member", "me"), member("agent", "bot")]), "me")).toMatchObject({
      member_type: "agent",
      member_id: "bot",
    });
  });

  it("treats a two-person group and a chat without the user as not direct", () => {
    expect(directChatPeer(chat("a", [member("member", "me"), member("agent", "bot")], { direct: false }), "me")).toBeNull();
    expect(directChatPeer(chat("b", [member("member", "x"), member("agent", "bot")]), "me")).toBeNull();
  });

  it("does not confuse an agent sharing the user's id with the user", () => {
    expect(directChatPeer(chat("a", [member("member", "me"), member("agent", "me")]), "me")).toMatchObject({
      member_type: "agent",
      member_id: "me",
    });
  });
});

describe("findDirectChat", () => {
  it("finds the oldest direct chat with the peer and ignores groups", () => {
    const chats = [
      chat("group", [member("member", "me"), member("agent", "bot")], { direct: false, created_at: "2025-01-01T00:00:00Z" }),
      chat("newer", [member("member", "me"), member("agent", "bot")], { created_at: "2026-03-01T00:00:00Z" }),
      chat("older", [member("agent", "bot"), member("member", "me")], { created_at: "2026-02-01T00:00:00Z" }),
      chat("other", [member("member", "me"), member("member", "bot")], { created_at: "2025-01-01T00:00:00Z" }),
    ];
    expect(findDirectChat(chats, "me", { member_type: "agent", member_id: "bot" })?.id).toBe("older");
    expect(findDirectChat(chats, "me", { member_type: "member", member_id: "bot" })?.id).toBe("other");
    expect(findDirectChat(chats, "me", { member_type: "agent", member_id: "x" })).toBeNull();
  });
});
