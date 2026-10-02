// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { GroupChat } from "@multica/core/types";
import type { Comment } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { setChatDraft } from "./chat-draft";
import { ChatSidebar } from "./chat-sidebar";

const appForeground = vi.hoisted(() => ({ value: true }));

vi.mock("../common/use-app-foreground", () => ({ useAppForeground: () => appForeground.value }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => `name-${id}` }),
}));

function chat(id: string, unread: number, pinned = false): GroupChat {
  return {
    id,
    workspace_id: "ws-1",
    identifier: id,
    title: `Room ${id}`,
    description: "",
    creator_type: "member",
    creator_id: "user-1",
    created_at: "2026-09-28T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [],
    pending_speakers: [],
    unread_count: unread,
    is_direct: false,
    pinned,
  };
}

function renderSidebar(selectedId: string | null, chats = [chat("a", 3), chat("b", 2), chat("c", 0)]) {
  const onSetPinned = vi.fn();
  renderWithI18n(
    <ChatSidebar
      chats={chats}
      isLoading={false}
      isError={false}
      selectedId={selectedId}
      userId="user-1"
      onSelect={() => {}}
      onNewChat={() => {}}
      onSetPinned={onSetPinned}
    />,
  );
  return onSetPinned;
}

function message(content: string): Comment {
  return {
    id: "m1",
    issue_id: "a",
    author_type: "member",
    author_id: "user-2",
    content,
    type: "comment",
    parent_id: null,
    reactions: [],
    attachments: [],
    created_at: "2026-09-28T00:00:00Z",
    updated_at: "2026-09-28T00:00:00Z",
    resolved_at: null,
    resolved_by_type: null,
    resolved_by_id: null,
  };
}

describe("ChatSidebar unread badges", () => {
  beforeEach(() => {
    localStorage.clear();
    appForeground.value = true;
  });

  it("badges each chat with its unread messages and skips the open one", () => {
    renderSidebar("b");
    expect(screen.getByLabelText("3 unread messages")).toHaveTextContent("3");
    expect(screen.queryByLabelText("2 unread messages")).toBeNull();
  });

  it("keeps the open chat's badge while the app is in the background", () => {
    appForeground.value = false;
    renderSidebar("b");
    expect(screen.getByLabelText("2 unread messages")).toHaveTextContent("2");
  });
});

describe("ChatSidebar drafts", () => {
  beforeEach(() => localStorage.clear());

  it("replaces the last-message summary with a red draft label", () => {
    setChatDraft("a", "not sent\nyet");
    renderSidebar(null, [{ ...chat("a", 0), last_message: message("shipped it") }, chat("b", 0)]);

    const row = screen.getByRole("button", { name: /Room a/ });
    expect(row).toHaveTextContent("[Draft] not sent yet");
    expect(row).not.toHaveTextContent("shipped it");
    expect(screen.getByText("[Draft]")).toHaveClass("text-destructive");
    expect(screen.getByRole("button", { name: /Room b/ })).toHaveTextContent("No messages yet");
  });

  it("keeps the last message when the draft is only whitespace", () => {
    setChatDraft("a", "   \n");
    renderSidebar(null, [chat("a", 0)]);
    expect(screen.getByRole("button", { name: /Room a/ })).toHaveTextContent("No messages yet");
    expect(screen.queryByText("[Draft]")).toBeNull();
  });
});

describe("ChatSidebar pinning", () => {
  beforeEach(() => localStorage.clear());

  it("pins a chat from its right-click menu", async () => {
    const onSetPinned = renderSidebar(null);
    fireEvent.contextMenu(screen.getByText("Room b"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin to top" }));
    expect(onSetPinned).toHaveBeenCalledWith("b", true);
  });

  it("marks a pinned chat and offers to unpin it", async () => {
    const onSetPinned = renderSidebar(null, [chat("a", 0, true), chat("b", 0)]);
    expect(screen.getAllByRole("img", { name: "Pinned" })).toHaveLength(1);
    fireEvent.contextMenu(screen.getByText("Room a"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin" }));
    expect(onSetPinned).toHaveBeenCalledWith("a", false);
  });
});
