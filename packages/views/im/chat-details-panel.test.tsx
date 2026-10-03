// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatDetailsPanel, rosterColumnCount } from "./chat-details-panel";

const updateMutateAsync = vi.fn();
const mockModalOpen = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/modals", () => ({
  useModalStore: Object.assign(vi.fn(), { getState: () => ({ open: mockModalOpen }) }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: vi.fn(() => ({ data: [] })) };
});

vi.mock("@multica/core/group-chats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/group-chats")>();
  return {
    ...actual,
    useRemoveGroupChatMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateGroupChat: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  };
});

vi.mock("@multica/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});

vi.mock("@multica/core/runtimes", () => ({
  runtimeDisplayName: () => "runtime",
  runtimeListOptions: () => ({ queryKey: ["runtimes"] }),
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => `name-${id}` }),
}));

vi.mock("./use-chat-directory", async () => {
  const actual = await vi.importActual<typeof import("./use-chat-directory")>("./use-chat-directory");
  return {
    ...actual,
    useChatDirectory: () => ({
      agentList: [],
      byKey: new Map([["agent:agent-1", { type: "agent", id: "agent-1", name: "Lambda", detail: "Reviews pull requests" }]]),
    }),
  };
});
const startDirectChat = vi.hoisted(() => vi.fn());
vi.mock("./use-direct-chat", () => ({ useStartDirectChat: () => ({ start: startDirectChat, isPending: false }) }));
vi.mock("./add-member-dialog", () => ({ AddMemberDialog: () => null }));
const avatarProps = vi.hoisted(() => vi.fn());
vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: (props: { actorId?: string; showStatusDot?: boolean }) => {
    avatarProps(props);
    return null;
  },
}));
vi.mock("../editor", () => ({
  ContentEditor: ({ value, onUpdate }: { value: string; onUpdate: (md: string) => void }) => (
    <textarea aria-label="announcement" defaultValue={value} onChange={(e) => onUpdate(e.target.value)} />
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

function renderPanel() {
  return renderWithI18n(<ChatDetailsPanel wsId="ws-1" chat={chat} userId="user-2" />);
}

describe("rosterColumnCount", () => {
  it("keeps a 16px margin between 48px avatars", () => {
    expect(rosterColumnCount(200)).toBe(3);
    expect(rosterColumnCount(48 + 16 + 48 - 1)).toBe(1);
    expect(rosterColumnCount(48 + 16 + 48)).toBe(2);
    expect(rosterColumnCount(5 * 48 + 4 * 16)).toBe(5);
    expect(rosterColumnCount(48)).toBe(1);
    expect(rosterColumnCount(47)).toBe(1);
    expect(rosterColumnCount(0)).toBe(1);
    expect(rosterColumnCount(Number.NaN)).toBe(1);
  });
});

describe("ChatDetailsPanel rename", () => {
  beforeEach(() => updateMutateAsync.mockReset().mockResolvedValue(chat));

  it("saves a trimmed title on Enter, even for a member who is not the creator", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Rename chat" }));
    const input = screen.getByRole("textbox", { name: "Chat name" });
    expect(input).toHaveValue("Launch room");

    fireEvent.change(input, { target: { value: "  War room  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({ title: "War room" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Chat name" })).toBeNull());
  });

  it("cancels on Escape and skips unchanged or blank titles", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Rename chat" }));
    const input = screen.getByRole("textbox", { name: "Chat name" });
    fireEvent.change(input, { target: { value: "Other" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Chat name" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rename chat" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Chat name" }), { key: "Enter" });

    expect(updateMutateAsync).not.toHaveBeenCalled();
  });
});

describe("ChatDetailsPanel announcement", () => {
  beforeEach(() => updateMutateAsync.mockReset().mockResolvedValue(chat));

  it("saves the edited announcement as the chat description", async () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "announcement" }), { target: { value: "Ship on **Friday**" } });

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({ description: "Ship on **Friday**" }));
  });
});

describe("ChatDetailsPanel agent members", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockModalOpen.mockReset();
    startDirectChat.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  function renderWithAgent() {
    renderWithI18n(
      <ChatDetailsPanel
        wsId="ws-1"
        chat={{
          ...chat,
          members: [
            ...chat.members,
            { member_type: "agent", member_id: "agent-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
          ],
        }}
        userId="user-2"
      />,
    );
    return screen.getByRole("button", { name: "name-agent-1" });
  }

  it("opens an agent member in the detail modal once the double-click window passes", () => {
    fireEvent.click(renderWithAgent());
    expect(mockModalOpen).not.toHaveBeenCalled();

    act(() => vi.runAllTimers());
    expect(mockModalOpen).toHaveBeenCalledWith("agent-detail", { agentId: "agent-1", hostPathname: undefined });
    expect(startDirectChat).not.toHaveBeenCalled();
  });

  it("opens the direct chat with an agent member on a double click instead of the modal", () => {
    const row = renderWithAgent();
    fireEvent.click(row);
    fireEvent.click(row);
    fireEvent.doubleClick(row);
    act(() => vi.runAllTimers());

    expect(startDirectChat).toHaveBeenCalledWith({ member_type: "agent", member_id: "agent-1" });
    expect(mockModalOpen).not.toHaveBeenCalled();
  });
});

describe("ChatDetailsPanel direct chat", () => {
  beforeEach(() => mockModalOpen.mockReset());

  it("shows only the other side's profile", () => {
    renderWithI18n(
      <ChatDetailsPanel
        wsId="ws-1"
        chat={{
          ...chat,
          is_direct: true,
          members: [
            ...chat.members,
            { member_type: "agent", member_id: "agent-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
          ],
        }}
        userId="user-1"
      />,
    );

    expect(screen.getByRole("heading", { name: "Lambda" })).toBeInTheDocument();
    expect(screen.getByText("Reviews pull requests")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename chat" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "announcement" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add member/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(mockModalOpen).toHaveBeenCalledWith("agent-detail", { agentId: "agent-1", hostPathname: undefined });
  });

  it("keeps the group settings of a two-person chat created as a group", () => {
    renderWithI18n(
      <ChatDetailsPanel
        wsId="ws-1"
        chat={{
          ...chat,
          members: [
            ...chat.members,
            { member_type: "agent", member_id: "agent-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
          ],
        }}
        userId="user-1"
      />,
    );

    expect(screen.getByRole("button", { name: "Rename chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add member/ })).toBeInTheDocument();
  });
});

describe("ChatDetailsPanel roster", () => {
  beforeEach(() => avatarProps.mockReset());

  function renderMixed(userId = "user-2") {
    renderWithI18n(
      <ChatDetailsPanel
        wsId="ws-1"
        chat={{
          ...chat,
          members: [
            ...chat.members,
            { member_type: "agent", member_id: "agent-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
          ],
        }}
        userId={userId}
      />,
    );
  }

  it("mixes people and agents in one roster and marks only agents with a presence dot", () => {
    renderMixed();

    expect(screen.queryByRole("heading", { name: "Agents in this chat" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "People in this chat" })).toBeNull();
    const agentName = screen.getByRole("button", { name: "name-agent-1" });
    const memberName = screen.getByText("name-user-1");
    expect(agentName).toBeInTheDocument();
    expect(memberName).toBeInTheDocument();
    const roster = screen.getByRole("group", { name: "People and agents" });
    expect(roster.style.columnGap).toBe("16px");
    expect(roster.style.rowGap).toBe("16px");
    for (const cls of ["h-4", "leading-4", "p-0", "border-0"]) {
      expect(agentName).toHaveClass(cls);
      expect(memberName).toHaveClass(cls);
    }

    const calls = avatarProps.mock.calls.map((call) => call[0] as { actorId?: string; showStatusDot?: boolean });
    expect(calls.find((props) => props.actorId === "agent-1")?.showStatusDot).toBe(true);
    expect(calls.find((props) => props.actorId === "user-1")?.showStatusDot).toBe(false);
  });

  it("filters the mixed roster by name", () => {
    renderMixed("user-1");
    expect(screen.getByRole("button", { name: /Add member/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "agent-1" } });

    expect(screen.getByRole("button", { name: "name-agent-1" })).toBeInTheDocument();
    expect(screen.queryByText("name-user-1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add member/ })).toBeNull();
  });
});

describe("ChatDetailsPanel documents", () => {
  const note = {
    id: "m1",
    type: "comment" as const,
    deleted_at: null,
    created_at: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    content: '```obsidian\n{"name":"Weekly","summary":"Shipped","path":"Work/Weekly.md"}\n```',
  };

  beforeEach(() => {
    vi.mocked(useQuery).mockImplementation((options) => {
      const key = (options as { queryKey?: readonly unknown[] }).queryKey ?? [];
      if (key.includes("messages")) return { data: [note] } as ReturnType<typeof useQuery>;
      return { data: [] } as ReturnType<typeof useQuery>;
    });
  });

  afterEach(() => {
    vi.mocked(useQuery).mockReset();
    vi.mocked(useQuery).mockImplementation(() => ({ data: [] }) as ReturnType<typeof useQuery>);
  });

  function renderInPanel(next: GroupChat) {
    renderWithI18n(
      <QueryClientProvider client={new QueryClient()}>
        <ChatDetailsPanel wsId="ws-1" chat={next} userId="user-1" />
      </QueryClientProvider>,
    );
  }

  it("adds the document list to the group sidebar", () => {
    renderInPanel(chat);
    expect(screen.getByRole("heading", { name: "Documents in this group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Weekly/ })).toHaveTextContent("Shipped");
    expect(screen.getByRole("button", { name: "Rename chat" })).toBeInTheDocument();
  });

  it("adds the document list to a direct chat under the profile", () => {
    renderInPanel({
      ...chat,
      is_direct: true,
      members: [
        ...chat.members,
        { member_type: "agent", member_id: "agent-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
      ],
    });
    expect(screen.getByRole("heading", { name: "Documents in this chat" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lambda" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename chat" })).toBeNull();
  });
});
