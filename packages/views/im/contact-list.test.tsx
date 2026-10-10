// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ContactList } from "./contact-list";

vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("./im-sidebar-search", () => ({
  ImSidebarSearch: () => <input aria-label="Search" />,
}));

function chat(id: string, title: string, extra: Partial<GroupChat> = {}): GroupChat {
  return {
    id,
    workspace_id: "ws-1",
    identifier: id,
    title,
    description: "",
    creator_type: "member",
    creator_id: "user-1",
    created_at: "2026-09-28T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [],
    pending_speakers: [],
    unread_count: 0,
    is_direct: false,
    pinned: false,
    task: false,
    status: "",
    ...extra,
  };
}

describe("ContactList group chats", () => {
  it("lists rooms people created and leaves out task chats", () => {
    renderWithI18n(
      <ContactList
        people={[]}
        agents={[]}
        chats={[
          chat("room", "Launch"),
          chat("task", "Book a room", { task: true, status: "todo" }),
          chat("direct", "Ada", {
            is_direct: true,
            members: [
              { member_type: "member", member_id: "user-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
              { member_type: "member", member_id: "user-2", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
            ],
          }),
        ]}
        userId="user-1"
        selectedKey={null}
        selectedChatId={null}
        onSelect={() => {}}
        onOpenChat={() => {}}
        onCreateAgent={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /Launch/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Book a room/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ada/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Group chats/ })).toHaveTextContent("1");
  });
});
