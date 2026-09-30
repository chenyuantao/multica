// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatDetailsPanel } from "./chat-details-panel";

const updateMutateAsync = vi.fn();
const mockModalOpen = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/modals", () => ({
  useModalStore: Object.assign(vi.fn(), { getState: () => ({ open: mockModalOpen }) }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: vi.fn(() => ({ data: [] })) };
});

vi.mock("@multica/core/group-chats", async () => ({
  directChatPeer: (await vi.importActual<typeof import("@multica/core/group-chats")>("@multica/core/group-chats")).directChatPeer,
  useRemoveGroupChatMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateGroupChat: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

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
vi.mock("./add-member-dialog", () => ({ AddMemberDialog: () => null }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
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
  is_direct: false,
  members: [
    { member_type: "member", member_id: "user-1", added_by_type: null, added_by_id: null, created_at: "2026-09-28T00:00:00Z" },
  ],
};

function renderPanel() {
  return renderWithI18n(<ChatDetailsPanel wsId="ws-1" chat={chat} userId="user-2" />);
}

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
  beforeEach(() => mockModalOpen.mockReset());

  it("opens an agent member in the detail modal", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "name-agent-1" }));

    expect(mockModalOpen).toHaveBeenCalledWith("agent-detail", { agentId: "agent-1", hostPathname: undefined });
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
