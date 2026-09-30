// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { Comment, GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatThread } from "./chat-thread";

const sendMutateAsync = vi.fn();

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: vi.fn() };
});

vi.mock("@multica/core/group-chats", () => ({
  groupChatMessagesOptions: () => ({ queryKey: ["messages"] }),
  useSendGroupChatMessage: () => ({ mutateAsync: sendMutateAsync }),
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => `name-${id}` }),
}));

vi.mock("../modals/agent-detail", () => ({ useOpenAgentDetail: () => vi.fn() }));
vi.mock("../platform", () => ({ DragStrip: () => null }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("../rich-content", () => ({ RichContent: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock("./chat-composer", () => ({
  ChatComposer: ({ onSend }: { onSend: (content: string) => void }) => (
    <button type="button" onClick={() => onSend("hello")}>
      send
    </button>
  ),
}));

const chat: GroupChat = {
  id: "chat-1",
  workspace_id: "ws-1",
  identifier: "MUL-1",
  title: "Launch room",
  description: "",
  creator_type: "member",
  creator_id: "user-1",
  created_at: "2026-09-28T00:00:00Z",
  last_comment_at: null,
  last_message: null,
  pending_speakers: [],
  members: [
    { member_type: "member", member_id: "user-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
  ],
};

function message(id: string, content: string): Comment {
  return {
    id,
    issue_id: chat.id,
    author_type: "member",
    author_id: "user-1",
    content,
    type: "comment",
    parent_id: null,
    reactions: [],
    attachments: [],
    resolved_at: null,
    resolved_by_type: null,
    resolved_by_id: null,
    created_at: "2026-09-30T13:00:00Z",
    updated_at: "2026-09-30T13:00:00Z",
  };
}

let messages: Comment[] = [];

function renderThread() {
  return renderWithI18n(
    <ChatThread wsId="ws-1" chat={chat} userId="user-1" panelOpen={false} onTogglePanel={() => {}} />,
  );
}

describe("ChatThread pending messages", () => {
  beforeEach(() => {
    messages = [message("m-0", "hello")];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    sendMutateAsync.mockReset().mockReturnValue(new Promise(() => {}));
  });

  it("hides the pending bubble once its echo arrives before the send resolves", () => {
    const view = renderThread();
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(screen.getAllByText("hello")).toHaveLength(2);
    expect(screen.getByText("Sending…")).toBeInTheDocument();

    messages = [...messages, message("m-1", "hello")];
    act(() => {
      view.rerender(
        <ChatThread wsId="ws-1" chat={chat} userId="user-1" panelOpen={false} onTogglePanel={() => {}} />,
      );
    });

    expect(screen.getAllByText("hello")).toHaveLength(2);
    expect(screen.queryByText("Sending…")).toBeNull();
  });
});
