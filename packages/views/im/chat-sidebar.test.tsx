// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Comment, GroupChat, Reminder } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { setChatDraft } from "./chat-draft";
import { ChatSidebar } from "./chat-sidebar";
import { toDateKey } from "./reminder-dates";

const reminders = vi.hoisted(() => ({ items: undefined as Reminder[] | undefined }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => ({ data: reminders.items }),
  };
});
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/reminders", () => ({
  reminderListOptions: () => ({ queryKey: ["reminders"] }),
}));

const appForeground = vi.hoisted(() => ({ value: true }));

vi.mock("../common/use-app-foreground", () => ({ useAppForeground: () => appForeground.value }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("./im-sidebar-search", () => ({
  ImSidebarSearch: () => <input aria-label="Search" />,
}));
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
    task: false,
    status: "",
  };
}

function reminder(id: string, title: string, due: string): Reminder {
  return {
    id,
    workspace_id: "ws-1",
    identifier: id,
    title,
    description: "",
    creator_type: "member",
    creator_id: "user-1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [],
    pending_speakers: [],
    unread_count: 0,
    is_direct: false,
    pinned: false,
    task: true,
    status: "todo",
    due_date: due,
    position: 1,
    pending: false,
  };
}

function renderSidebar(selectedId: string | null, chats = [chat("a", 3), chat("b", 2), chat("c", 0)]) {
  const onSelect = vi.fn();
  const onSetPinned = vi.fn();
  const onSetDone = vi.fn();
  renderWithI18n(
    <ChatSidebar
      chats={chats}
      isLoading={false}
      isError={false}
      selectedId={selectedId}
      userId="user-1"
      onSelect={onSelect}
      onNewChat={() => {}}
      onSetPinned={onSetPinned}
      onSetDone={onSetDone}
    />,
  );
  return { onSelect, onSetPinned, onSetDone };
}

function chatRow(name: RegExp) {
  const row = screen.getByRole("button", { name }).closest("li");
  if (!row) throw new Error(`missing chat row ${name}`);
  return row;
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

    const row = chatRow(/Room a/);
    expect(row).toHaveTextContent("[Draft] not sent yet");
    expect(row).not.toHaveTextContent("shipped it");
    expect(screen.getByText("[Draft]")).toHaveClass("text-destructive");
    expect(chatRow(/Room b/)).toHaveTextContent("No messages yet");
  });

  it("keeps the last message on the open chat even when a draft is stored", () => {
    setChatDraft("a", "not sent\nyet");
    renderSidebar("a", [{ ...chat("a", 0), last_message: message("shipped it") }, chat("b", 0)]);

    const row = chatRow(/Room a/);
    expect(row).toHaveTextContent("shipped it");
    expect(row).not.toHaveTextContent("[Draft]");
    expect(screen.queryByText("[Draft]")).toBeNull();
  });

  it("keeps the last message when the draft is only whitespace", () => {
    setChatDraft("a", "   \n");
    renderSidebar(null, [chat("a", 0)]);
    expect(chatRow(/Room a/)).toHaveTextContent("No messages yet");
    expect(screen.queryByText("[Draft]")).toBeNull();
  });
});

describe("ChatSidebar pinning", () => {
  beforeEach(() => localStorage.clear());

  it("pins a chat from its right-click menu", async () => {
    const { onSetPinned } = renderSidebar(null);
    fireEvent.contextMenu(screen.getByText("Room b"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin to top" }));
    expect(onSetPinned).toHaveBeenCalledWith("b", true);
  });

  it("marks a pinned chat and offers to unpin it", async () => {
    const { onSetPinned } = renderSidebar(null, [chat("a", 0, true), chat("b", 0)]);
    expect(screen.getAllByRole("img", { name: "Pinned" })).toHaveLength(1);
    fireEvent.contextMenu(screen.getByText("Room a"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin" }));
    expect(onSetPinned).toHaveBeenCalledWith("a", false);
  });

  it("does not offer task status on an ordinary chat", async () => {
    renderSidebar(null, [chat("a", 0)]);
    fireEvent.contextMenu(screen.getByText("Room a"));
    expect(await screen.findByRole("menuitem", { name: "Pin to top" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Mark as done" })).toBeNull();
  });
});

describe("ChatSidebar task chats", () => {
  beforeEach(() => {
    localStorage.clear();
    reminders.items = undefined;
  });

  it("marks an open task with an empty circle, and a finished one with a blue check", () => {
    renderSidebar(null, [
      chat("a", 0),
      { ...chat("b", 0), task: true, status: "todo", title: "Open task" },
      { ...chat("c", 0), task: true, status: "done", title: "Done task" },
    ]);
    const ordinary = chatRow(/Room a/);
    expect(ordinary).not.toHaveTextContent("Task");
    expect(within(ordinary).queryByRole("button", { name: "Mark as done" })).toBeNull();
    expect(within(ordinary).queryByRole("button", { name: "Mark as not done" })).toBeNull();
    const open = within(chatRow(/Open task/)).getByRole("button", { name: "Mark as done" });
    expect(open).toHaveAttribute("aria-pressed", "false");
    expect(open.querySelector("svg")).not.toHaveClass("text-info");
    const done = within(chatRow(/Done task/)).getByRole("button", { name: "Mark as not done" });
    expect(done).toHaveAttribute("aria-pressed", "true");
    expect(done.querySelector("svg")).toHaveClass("text-info");
  });

  it("toggles a task from the list icon without opening the chat", () => {
    const open = renderSidebar(null, [{ ...chat("b", 0), task: true, status: "todo", title: "Open task" }]);
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(open.onSetDone).toHaveBeenCalledWith("b", true);
    expect(open.onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Open task/ }));
    expect(open.onSelect).toHaveBeenCalledWith("b");

    const finished = renderSidebar(null, [{ ...chat("c", 0), task: true, status: "done", title: "Done task" }]);
    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(finished.onSetDone).toHaveBeenCalledWith("c", false);
    expect(finished.onSelect).not.toHaveBeenCalled();
  });

  it("opens a filter with the to-do views plus only to-dos and only non-to-dos", () => {
    const today = toDateKey(new Date());
    reminders.items = [
      reminder("b", "Open task", today),
      reminder("c", "Later task", "2020-01-01"),
      reminder("d", "Write #docs", today),
    ];
    renderSidebar(null, [
      chat("a", 0),
      { ...chat("b", 0), task: true, status: "todo", title: "Open task" },
      { ...chat("c", 0), task: true, status: "todo", title: "Later task" },
      { ...chat("d", 0), task: true, status: "todo", title: "Write #docs" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Only to-dos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Only non-to-dos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(screen.getByRole("button", { name: "Previous week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide completed" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("button", { name: "Back to this week" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));

    fireEvent.click(screen.getByRole("button", { name: "Only non-to-dos" }));
    expect(screen.queryByRole("button", { name: /Open task/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Room a/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter chats" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: /Open task/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Later task/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Room a/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^#docs/ }));
    expect(screen.getByRole("button", { name: /Write #docs/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open task/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Only to-dos" }));
    expect(screen.queryByRole("button", { name: /Room a/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Write #docs/ })).toBeInTheDocument();
  });

  it("says so when the filter hides every chat", () => {
    renderSidebar(null, [{ ...chat("b", 0), task: true, status: "todo" }]);
    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Only non-to-dos" }));
    expect(screen.getByText("No chats match this filter")).toBeInTheDocument();
  });

  it("marks a task done from the sidebar menu", async () => {
    const { onSetDone } = renderSidebar(null, [{ ...chat("b", 0), task: true, status: "todo" }]);
    fireEvent.contextMenu(screen.getByText("Room b"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as done" }));
    expect(onSetDone).toHaveBeenCalledWith("b", true);
  });

  it("reopens a finished task from the sidebar menu", async () => {
    const { onSetDone } = renderSidebar(null, [{ ...chat("b", 0), task: true, status: "done" }]);
    fireEvent.contextMenu(screen.getByText("Room b"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark as not done" }));
    expect(onSetDone).toHaveBeenCalledWith("b", false);
  });

  it("keeps the last filter after leaving and returning", () => {
    const today = toDateKey(new Date());
    reminders.items = [reminder("b", "Open task", today)];
    const chats = [chat("a", 0), { ...chat("b", 0), task: true, status: "todo", title: "Open task" }];
    renderSidebar(null, chats);
    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Only to-dos" }));
    expect(screen.queryByRole("button", { name: /Room a/ })).toBeNull();

    cleanup();
    renderSidebar(null, chats);
    expect(screen.queryByRole("button", { name: /Room a/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Open task/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    expect(screen.getByRole("button", { name: "Only to-dos" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("multica:im-chat-filter:ws-1")).toContain('"scope":"todo"');
  });
});
