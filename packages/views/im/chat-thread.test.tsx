// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { Comment, GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatThread } from "./chat-thread";

const sendMutateAsync = vi.fn();
const cancelRun = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false }));
const deleteMessage = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const copyText = vi.hoisted(() => vi.fn());
const currentMember = vi.hoisted(() => ({ role: "member" as string | null }));
vi.mock("@multica/core/permissions", () => ({ useCurrentMember: () => currentMember }));

vi.mock("@multica/ui/lib/clipboard", () => ({ copyText }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: vi.fn() };
});

vi.mock("@multica/core/group-chats", () => ({
  groupChatMessagesOptions: () => ({ queryKey: ["messages"] }),
  useSendGroupChatMessage: () => ({ mutateAsync: sendMutateAsync }),
  useDeleteGroupChatMessage: () => deleteMessage,
}));

vi.mock("@multica/core/issues/mutations", () => ({ useCancelIssueRun: () => cancelRun }));
vi.mock("@multica/core/chat/queries", () => ({ useTaskMessages: () => ({ data: [] }) }));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => `name-${id}` }),
}));

vi.mock("../modals/agent-detail", () => ({ useOpenAgentDetail: () => vi.fn() }));
vi.mock("../platform", () => ({ DragStrip: () => null }));
vi.mock("./mobile-shell", () => ({ MobileLevelHeader: () => null }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("../rich-content", () => ({ RichContent: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock("./chat-composer", () => ({
  QuoteText: ({ quote }: { quote: { name: string; text: string } }) => <span>{`${quote.name}: ${quote.text}`}</span>,
  ChatComposer: ({
    onSend,
    quote,
    onCancelQuote,
  }: {
    onSend: (content: string, attachmentIds: string[]) => void;
    quote?: { name: string; text: string } | null;
    onCancelQuote?: () => void;
  }) => (
    <>
      <button type="button" onClick={() => onSend("hello", [])}>
        send
      </button>
      {quote && (
        <>
          <p data-testid="composer-quote">{`${quote.name}: ${quote.text}`}</p>
          <button type="button" onClick={onCancelQuote}>
            cancel quote
          </button>
        </>
      )}
    </>
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

describe("ChatThread thinking bubble", () => {
  beforeEach(() => {
    cancelRun.mutate.mockReset();
    cancelRun.isPending = false;
    cancelRun.isSuccess = false;
  });

  function renderThinking() {
    messages = [{ ...message("m-1", "思考中..."), author_type: "agent", author_id: "agent-1", source_task_id: "task-1" }];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    renderThread();
  }

  it("stops the run the bubble stands in for", () => {
    renderThinking();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(cancelRun.mutate).toHaveBeenCalledWith("task-1", expect.anything());
  });

  it("shows the stop control without hover on touch screens", () => {
    renderThinking();
    expect(screen.getByRole("button", { name: "Stop" }).className).toContain("[@media(hover:none)]:opacity-100");
  });

  it("keeps the control disabled once the stop was accepted", () => {
    cancelRun.isSuccess = true;
    renderThinking();
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });

  it("offers no stop control on a finished reply", () => {
    messages = [{ ...message("m-1", "done"), author_type: "agent", author_id: "agent-1", source_task_id: "task-1" }];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    renderThread();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});

describe("ChatThread message menu", () => {
  beforeEach(() => {
    messages = [
      { ...message("m-1", "Ship **v2** on Friday"), author_id: "user-2" },
      message("m-2", "sounds good"),
    ];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    sendMutateAsync.mockReset().mockReturnValue(new Promise(() => {}));
    deleteMessage.mutate.mockReset();
    copyText.mockReset().mockResolvedValue(true);
    currentMember.role = "member";
  });

  async function openMenu(text: string) {
    fireEvent.contextMenu(screen.getByText(text));
    return screen.findByRole("menu");
  }

  it("copies the message source", async () => {
    renderThread();
    await openMenu("Ship **v2** on Friday");
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith("Ship **v2** on Friday");
  });

  it("offers delete only on the viewer's own messages", async () => {
    renderThread();
    await openMenu("Ship **v2** on Friday");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(deleteMessage.mutate).toHaveBeenCalledWith("m-2", expect.anything());
  });

  it("quotes a message on the next send, and a new quote replaces it", async () => {
    renderThread();
    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    expect(screen.getByTestId("composer-quote")).toHaveTextContent("name-user-1: sounds good");

    await openMenu("Ship **v2** on Friday");
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    expect(screen.getByTestId("composer-quote")).toHaveTextContent("name-user-2: Ship v2 on Friday");

    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(sendMutateAsync).toHaveBeenCalledWith({ content: "hello", attachmentIds: [], refMessageId: "m-1" });
    expect(screen.queryByTestId("composer-quote")).toBeNull();
  });

  it("drops the quote when cancelled", async () => {
    renderThread();
    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    fireEvent.click(screen.getByRole("button", { name: "cancel quote" }));
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(sendMutateAsync).toHaveBeenCalledWith({ content: "hello", attachmentIds: [], refMessageId: undefined });
  });

  it("shows what a message quotes, or that the quoted one is gone", () => {
    messages = [
      ...messages,
      { ...message("m-3", "why Friday?"), ref_message_id: "m-1" },
      { ...message("m-4", "never mind"), ref_message_id: "gone" },
    ];
    renderThread();
    expect(screen.getByRole("button", { name: "name-user-2: Ship v2 on Friday" })).toBeInTheDocument();
    expect(screen.getByText("Quoted message was deleted")).toBeInTheDocument();
  });
});

describe("ChatThread moderation and phone menu", () => {
  beforeEach(() => {
    messages = [{ ...message("m-1", "Ship v2 on Friday"), author_id: "user-2" }];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    sendMutateAsync.mockReset().mockReturnValue(new Promise(() => {}));
    deleteMessage.mutate.mockReset();
    currentMember.role = "member";
  });

  it("lets a workspace admin delete someone else's message", async () => {
    currentMember.role = "admin";
    renderThread();
    fireEvent.contextMenu(screen.getByText("Ship v2 on Friday"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(deleteMessage.mutate).toHaveBeenCalledWith("m-1", expect.anything());
  });

  function renderPhone() {
    renderWithI18n(
      <ChatThread
        wsId="ws-1"
        chat={chat}
        userId="user-1"
        panelOpen={false}
        onTogglePanel={() => {}}
        mobileNav={{ backHref: "/im", settingsHref: "/im/settings", onOpenProfile: () => {} }}
      />,
    );
  }

  it("opens the menu on a long press on phones", async () => {
    vi.useFakeTimers();
    try {
      renderPhone();
      fireEvent.touchStart(screen.getByText("Ship v2 on Friday"), { touches: [{ clientX: 10, clientY: 10 }] });
      act(() => vi.advanceTimersByTime(600));
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    expect(screen.getByTestId("composer-quote")).toHaveTextContent("name-user-2: Ship v2 on Friday");
  });

  it("keeps the menu closed when the press turns into a scroll", () => {
    vi.useFakeTimers();
    try {
      renderPhone();
      const bubble = screen.getByText("Ship v2 on Friday");
      fireEvent.touchStart(bubble, { touches: [{ clientX: 10, clientY: 10 }] });
      fireEvent.touchMove(bubble, { touches: [{ clientX: 10, clientY: 60 }] });
      act(() => vi.advanceTimersByTime(600));
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
