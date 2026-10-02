// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { Comment, GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { encodeChatHistory } from "./chat-history";
import { ChatThread } from "./chat-thread";

const sendMutateAsync = vi.fn();
const forwardMutateAsync = vi.fn();
const cancelRun = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false }));
const deleteMessage = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const copyText = vi.hoisted(() => vi.fn());
const currentMember = vi.hoisted(() => ({ role: "member" as string | null }));
const markRead = vi.hoisted(() => vi.fn());
const appForeground = vi.hoisted(() => ({ value: true }));

vi.mock("../common/use-app-foreground", () => ({ useAppForeground: () => appForeground.value }));

vi.mock("@multica/core/permissions", () => ({ useCurrentMember: () => currentMember }));

vi.mock("@multica/ui/lib/clipboard", () => ({ copyText }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: vi.fn() };
});

vi.mock("@multica/core/group-chats", async () => ({
  directChatPeer: (await vi.importActual<typeof import("@multica/core/group-chats")>("@multica/core/group-chats")).directChatPeer,
  groupChatListOptions: () => ({ queryKey: ["group-chats", "list"] }),
  groupChatMessagesOptions: () => ({ queryKey: ["messages"] }),
  useForwardChatHistory: () => ({ mutateAsync: forwardMutateAsync, isPending: false }),
  useSendGroupChatMessage: () => ({ mutateAsync: sendMutateAsync }),
  useDeleteGroupChatMessage: () => deleteMessage,
  useMarkGroupChatRead: () => ({ mutate: markRead }),
}));

vi.mock("@multica/core/issues/mutations", () => ({ useCancelIssueRun: () => cancelRun }));
vi.mock("@multica/core/chat/queries", () => ({ useTaskMessages: () => ({ data: [] }) }));
vi.mock("../common/task-transcript/agent-transcript-dialog", () => ({
  AgentTranscriptDialog: ({
    open,
    agentName,
    onStop,
    stopping,
  }: {
    open: boolean;
    agentName: string;
    onStop?: () => void;
    stopping?: boolean;
  }) =>
    open ? (
      <div role="dialog">
        {agentName}
        {onStop && (
          <button type="button" disabled={stopping} onClick={onStop}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
    ) : null,
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => `name-${id}` }),
}));

const openAgentDetail = vi.hoisted(() => vi.fn());
const startDirectChat = vi.hoisted(() => vi.fn());
vi.mock("../modals/agent-detail", () => ({ useOpenAgentDetail: () => openAgentDetail }));
vi.mock("./use-direct-chat", () => ({ useStartDirectChat: () => ({ start: startDirectChat, isPending: false }) }));
vi.mock("../platform", () => ({ DragStrip: () => null }));
vi.mock("./mobile-shell", () => ({ MobileLevelHeader: () => null }));
vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: ({ onPickConversationStarter }: { onPickConversationStarter?: (prompt: string) => void }) =>
    onPickConversationStarter ? (
      <button type="button" onClick={() => onPickConversationStarter("Summarize the thread.")}>
        hover starter
      </button>
    ) : null,
}));
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
  unread_count: 0,
  is_direct: false,
  pinned: false,
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

describe("ChatThread cancelled notice", () => {
  beforeEach(() => {
    messages = [
      {
        ...message(
          "m-cancel",
          '```multica-cancelled\n{"trigger":"check the deploy","request":{"state":{"previous":"check the deploy","latest":"and include the logs"}},"response":{"relation":{"type":"choice","choice":"追加","confidence":0.91}}}\n```',
        ),
        author_type: "system",
        author_id: "00000000-0000-0000-0000-000000000000",
        type: "system",
      },
    ];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
  });

  it("shows the cancellation as an error line with the trigger centered under it", () => {
    renderThread();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("A message in progress was cancelled");
    expect(status.querySelector(".text-destructive")).not.toBeNull();
    expect(screen.getByText("check the deploy")).toHaveClass("text-center");
    expect(screen.queryByText(/multica-cancelled/)).toBeNull();
  });

  it("opens the saved Jev request and response from Details", async () => {
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("dialog", { name: "Cancellation details" })).toBeInTheDocument();
    expect(screen.getByText("Request")).toBeInTheDocument();
    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(screen.getByText('"previous"')).toBeInTheDocument();
    expect(screen.getByText('"追加"')).toBeInTheDocument();
  });
});

describe("ChatThread agent author", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    messages = [{ ...message("m-0", "done"), author_type: "agent", author_id: "agent-1" }];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    openAgentDetail.mockReset();
    startDirectChat.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("opens the direct chat on a double click without showing the profile first", () => {
    renderThread();
    const name = screen.getByText("name-agent-1");
    fireEvent.click(name);
    fireEvent.click(name);
    fireEvent.doubleClick(name);
    act(() => vi.runAllTimers());

    expect(startDirectChat).toHaveBeenCalledWith({ member_type: "agent", member_id: "agent-1" });
    expect(openAgentDetail).not.toHaveBeenCalled();
  });
});

describe("ChatThread conversation starters", () => {
  const agent = {
    id: "agent-1",
    archived_at: null,
    conversation_starters: [
      { label: "Weekly report", prompt: "Draft this week's report." },
      { label: "Review PR", prompt: "Review the open PR." },
      { label: "Plan", prompt: "Plan the sprint." },
      { label: "Extra", prompt: "Not shown." },
    ],
  };
  const agentMember = { member_type: "agent" as const, member_id: "agent-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" };

  function mockQueries(agents: unknown[]) {
    vi.mocked(useQuery).mockImplementation(
      ((opts: { queryKey: unknown[] }) =>
        ({ data: opts.queryKey[0] === "messages" ? messages : agents, isError: false })) as never,
    );
  }

  function renderChat(over: Partial<GroupChat>) {
    return renderWithI18n(
      <ChatThread wsId="ws-1" chat={{ ...chat, ...over }} userId="user-1" panelOpen={false} onTogglePanel={() => {}} />,
    );
  }

  beforeEach(() => {
    messages = [];
    sendMutateAsync.mockReset().mockReturnValue(new Promise(() => {}));
  });

  it("sends a direct chat's starter as is, showing at most three", () => {
    mockQueries([agent]);
    renderChat({ is_direct: true, members: [...chat.members, agentMember] });

    expect(screen.getAllByRole("button", { name: /Weekly report|Review PR|Plan|Extra/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Weekly report" }));

    expect(sendMutateAsync).toHaveBeenCalledWith({
      content: "Draft this week's report.",
      attachmentIds: [],
      refMessageId: undefined,
    });
  });

  it("shows no starters for an agent that configured none", () => {
    mockQueries([{ ...agent, conversation_starters: [] }]);
    renderChat({ is_direct: true, members: [...chat.members, agentMember] });

    expect(screen.queryByRole("group", { name: "Conversation starters" })).toBeNull();
  });

  it("mentions the agent when a group chat sends its starter from the hover card", () => {
    mockQueries([agent]);
    messages = [{ ...message("m-0", "done"), author_type: "agent", author_id: "agent-1" }];
    renderChat({ members: [...chat.members, agentMember] });

    expect(screen.queryByRole("group", { name: "Conversation starters" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "hover starter" }));

    expect(sendMutateAsync).toHaveBeenCalledWith({
      content: "[@name-agent-1](mention://agent/agent-1) Summarize the thread.",
      attachmentIds: [],
      refMessageId: undefined,
    });
  });

  it("offers no hover starter for an agent that has left the group", () => {
    mockQueries([agent]);
    messages = [{ ...message("m-0", "done"), author_type: "agent", author_id: "agent-1" }];
    renderChat({});

    expect(screen.queryByRole("button", { name: "hover starter" })).toBeNull();
  });
});

describe("ChatThread read state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    messages = [message("m-0", "hello")];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    markRead.mockReset();
    appForeground.value = true;
  });
  afterEach(() => vi.useRealTimers());

  function render(unread: number, lastCommentAt: string | null = "2026-09-30T13:00:00Z") {
    const ui = (count: number, at: string | null) => (
      <ChatThread
        wsId="ws-1"
        chat={{ ...chat, unread_count: count, last_comment_at: at }}
        userId="user-1"
        panelOpen={false}
        onTogglePanel={() => {}}
      />
    );
    const view = renderWithI18n(ui(unread, lastCommentAt));
    return { rerender: (count: number, at: string | null = lastCommentAt) => view.rerender(ui(count, at)) };
  }

  it("reads the whole chat once it is open in front of the user", () => {
    render(3);
    act(() => vi.runAllTimers());
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("reads a message that lands while the chat stays open", () => {
    const view = render(0);
    act(() => vi.runAllTimers());
    expect(markRead).not.toHaveBeenCalled();

    view.rerender(1, "2026-09-30T13:05:00Z");
    act(() => vi.runAllTimers());
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("leaves messages unread while the app is in the background", () => {
    appForeground.value = false;
    const view = render(2);
    act(() => vi.runAllTimers());
    expect(markRead).not.toHaveBeenCalled();

    appForeground.value = true;
    view.rerender(2);
    act(() => vi.runAllTimers());
    expect(markRead).toHaveBeenCalledTimes(1);
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

  it("stops the run from the progress dialog, not beside the message", () => {
    renderThinking();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(cancelRun.mutate).toHaveBeenCalledWith("task-1", expect.anything());
  });

  it("opens the run progress from the thinking bubble", () => {
    renderThinking();
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("name-agent-1");
  });

  it("keeps the control disabled once the stop was accepted", () => {
    cancelRun.isSuccess = true;
    renderThinking();
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });

  it("opens the run on its own page from a phone instead of a dialog", () => {
    const onOpenProgress = vi.fn();
    messages = [{ ...message("m-1", "思考中..."), author_type: "agent", author_id: "agent-1", source_task_id: "task-1" }];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
    renderWithI18n(
      <ChatThread
        wsId="ws-1"
        chat={chat}
        userId="user-1"
        panelOpen={false}
        onTogglePanel={() => {}}
        mobileNav={{ backHref: "/im", settingsHref: "/im/settings", onOpenProfile: () => {}, onOpenProgress }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(onOpenProgress).toHaveBeenCalledWith("task-1");
    expect(screen.queryByRole("dialog")).toBeNull();
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

  function menuSequence(menu: HTMLElement) {
    return [...menu.querySelectorAll("[role='menuitem'], [data-slot='context-menu-separator']")].map((node) =>
      node.getAttribute("data-slot") === "context-menu-separator" ? "----" : node.textContent?.trim(),
    );
  }

  it("orders actions as ask, copy, then forward, select, quote, then delete", async () => {
    renderWithI18n(
      <ChatThread wsId="ws-1" chat={chat} userId="user-1" panelOpen={false} onTogglePanel={() => {}} onAskAI={() => {}} />,
    );
    expect(menuSequence(await openMenu("sounds good"))).toEqual([
      "Ask AI",
      "Copy",
      "----",
      "Forward",
      "Select",
      "Quote",
      "----",
      "Delete",
    ]);

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(menuSequence(await openMenu("Ship **v2** on Friday"))).toEqual([
      "Ask AI",
      "Copy",
      "----",
      "Forward",
      "Select",
      "Quote",
    ]);
  });

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

  it("asks AI about a message, with the text highlighted in it", async () => {
    const onAskAI = vi.fn();
    renderWithI18n(
      <ChatThread wsId="ws-1" chat={chat} userId="user-1" panelOpen={false} onTogglePanel={() => {}} onAskAI={onAskAI} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(onAskAI).toHaveBeenLastCalledWith();

    const text = screen.getByText("Ship **v2** on Friday").firstChild!;
    const range = document.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 11);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await openMenu("Ship **v2** on Friday");
    fireEvent.click(screen.getByRole("menuitem", { name: "Ask AI" }));
    expect(onAskAI).toHaveBeenLastCalledWith({
      message_id: "m-1",
      time: messages[1]!.created_at,
      sender: "name-user-2",
      content: "Ship **v2** on Friday",
      text: "**v2**",
    });

    window.getSelection()!.removeAllRanges();
    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Ask AI" }));
    expect(onAskAI.mock.lastCall?.[0]).not.toHaveProperty("text");
  });

  it("offers no Ask AI entry when the page gives none", async () => {
    renderThread();
    expect(screen.queryByRole("button", { name: "Ask AI" })).toBeNull();
    await openMenu("sounds good");
    expect(screen.queryByRole("menuitem", { name: "Ask AI" })).toBeNull();
  });

  it("drops the quote when cancelled", async () => {
    renderThread();
    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    fireEvent.click(screen.getByRole("button", { name: "cancel quote" }));
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(sendMutateAsync).toHaveBeenCalledWith({ content: "hello", attachmentIds: [], refMessageId: undefined });
  });

  it("sends the focused document with the message, and keeps a quote beside it", async () => {
    renderWithI18n(
      <ChatThread
        wsId="ws-1"
        chat={chat}
        userId="user-1"
        panelOpen={false}
        onTogglePanel={() => {}}
        focusNote={{ name: "本周周报", path: "notes/weekly.md" }}
      />,
    );
    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(sendMutateAsync).toHaveBeenCalledWith({
      content: "hello",
      attachmentIds: [],
      refMessageId: "m-2",
      focusNote: { name: "本周周报", path: "notes/weekly.md" },
    });
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

describe("ChatThread forward and multi-select", () => {
  const other: GroupChat = { ...chat, id: "chat-2", title: "Other room" };

  beforeEach(() => {
    messages = [
      { ...message("m-1", "Ship v2 on Friday"), author_id: "user-2" },
      message("m-2", "sounds good"),
    ];
    sendMutateAsync.mockReset().mockReturnValue(new Promise(() => {}));
    forwardMutateAsync.mockReset().mockResolvedValue({ sent: ["chat-2"], failed: [], noteFailed: [] });
    vi.mocked(useQuery).mockImplementation(
      ((opts: { queryKey?: readonly unknown[] }) => {
        const key = opts?.queryKey?.[0];
        if (key === "group-chats") return { data: [chat, other], isError: false, isLoading: false };
        if (key === "messages") return { data: messages, isError: false };
        return { data: [], isError: false };
      }) as never,
    );
  });

  async function openMenu(text: string) {
    fireEvent.contextMenu(screen.getByText(text));
    return screen.findByRole("menu");
  }

  it("offers forward and select, and refuses both on a thinking bubble", async () => {
    const view = renderThread();
    await openMenu("sounds good");
    expect(screen.getByRole("menuitem", { name: "Forward" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Select" })).toBeEnabled();
    view.unmount();

    messages = [{ ...message("m-3", "思考中..."), author_type: "agent", author_id: "agent-1", source_task_id: "task-1" }];
    renderThread();
    fireEvent.contextMenu(screen.getByText("思考中..."));
    const forward = await screen.findByRole("menuitem", { name: "Forward" });
    const select = screen.getByRole("menuitem", { name: "Select" });
    expect(forward).toHaveAttribute("aria-disabled", "true");
    expect(select).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(forward);
    expect(screen.queryByRole("heading", { name: "Forward to" })).toBeNull();
  });

  it("selects messages from the bar and leaves that mode on cancel", async () => {
    renderThread();
    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Select" }));
    expect(screen.queryByRole("button", { name: "send" })).toBeNull();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);

    fireEvent.click(screen.getByText("sounds good"));
    expect(screen.queryByRole("button", { pressed: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    fireEvent.click(screen.getByText("Ship v2 on Friday"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "send" })).toBeInTheDocument();
  });

  it("does not select a thinking bubble", async () => {
    messages = [
      message("m-1", "hello"),
      { ...message("m-2", "思考中..."), author_type: "agent", author_id: "agent-1", source_task_id: "task-1" },
    ];
    renderThread();
    await openMenu("hello");
    fireEvent.click(screen.getByRole("menuitem", { name: "Select" }));
    fireEvent.click(screen.getByText("思考中..."));
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("forwards the chosen messages as a history card, with a note after it", async () => {
    renderThread();
    await openMenu("sounds good");
    fireEvent.click(screen.getByRole("menuitem", { name: "Forward" }));
    fireEvent.click(await screen.findByRole("button", { name: /Other room/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Add a message" }), { target: { value: "see this" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(forwardMutateAsync).toHaveBeenCalled());
    const arg = forwardMutateAsync.mock.calls[0]?.[0] as { targets: string[]; card: string; note: string };
    expect(arg.targets).toEqual(["chat-2"]);
    expect(arg.note).toBe("see this");
    expect(arg.card).toContain("sounds good");
    expect(arg.card).not.toContain("Ship v2");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Forward to" })).toBeNull());
  });

  it("shows a history card summary and the full message in a dialog", async () => {
    messages = [
      message(
        "m-1",
        encodeChatHistory({
          messages: [
            {
              author_name: "Ada",
              content: "full body\n\n![shot](https://cdn.test/a.png)",
              created_at: "2026-09-30T13:00:00Z",
            },
          ],
        }),
      ),
    ];
    renderThread();
    const card = screen.getByRole("button", { name: /Chat History for Ada/ });
    expect(card).toHaveTextContent("[Image]");
    expect(card.className).toContain("h-[156px]");
    expect(card.className).toContain("w-[256px]");
    expect(screen.queryByText(/cdn.test/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Chat History for Ada/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("full body");
    expect(screen.getByRole("dialog")).toHaveTextContent("https://cdn.test/a.png");
  });

  it("opens a history card through the phone page instead of a dialog", () => {
    const onOpenHistory = vi.fn();
    messages = [
      message(
        "m-1",
        encodeChatHistory({
          messages: [{ author_name: "Ada", content: "full body", created_at: "2026-09-30T13:00:00Z" }],
        }),
      ),
    ];
    renderWithI18n(
      <ChatThread
        wsId="ws-1"
        chat={chat}
        userId="user-1"
        panelOpen={false}
        onTogglePanel={() => {}}
        mobileNav={{ backHref: "/im", settingsHref: "/im/settings", onOpenProfile: () => {}, onOpenHistory }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Chat History for Ada/ }));
    expect(onOpenHistory).toHaveBeenCalledWith("m-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ChatThread message search", () => {
  beforeEach(() => {
    messages = [
      message("m-1", "alpha release notes"),
      message("m-2", "beta roadmap"),
      message("m-3", "daily standup"),
    ];
    vi.mocked(useQuery).mockImplementation(() => ({ data: messages, isError: false }) as never);
  });

  it("opens from the header button left of the panel toggle", async () => {
    renderThread();
    const search = screen.getByRole("button", { name: /Search messages/ });
    const panel = screen.getByRole("button", { name: "Toggle chat details" });
    expect(search.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(search);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Search in this chat");
    expect(screen.getByRole("textbox", { name: "Filter messages" })).toBeInTheDocument();
  });

  it("opens with Cmd/Ctrl+F and hides non-matching messages", async () => {
    renderThread();
    fireEvent.keyDown(document, { key: "f", metaKey: true });
    const input = await screen.findByRole("textbox", { name: "Filter messages" });
    fireEvent.change(input, { target: { value: "release" } });

    expect(screen.getByText("alpha release notes")).toBeInTheDocument();
    expect(screen.queryByText("beta roadmap")).toBeNull();
    expect(screen.queryByText("daily standup")).toBeNull();
    expect(screen.getByText("1 matching")).toBeInTheDocument();
  });

  it("keeps the filter after the dialog closes until the query is cleared", async () => {
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: /Search messages/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Filter messages" }), {
      target: { value: "roadmap" },
    });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("beta roadmap")).toBeInTheDocument();
    expect(screen.queryByText("alpha release notes")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Search messages/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Filter messages" }), {
      target: { value: "" },
    });
    expect(screen.getByText("alpha release notes")).toBeInTheDocument();
    expect(screen.getByText("daily standup")).toBeInTheDocument();
  });
});
