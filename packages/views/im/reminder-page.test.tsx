// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { Agent, Reminder } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { ReminderPage } from "./reminder-page";

const isMobile = vi.hoisted(() => ({ current: false }));
const updateMutate = vi.hoisted(() => vi.fn());
const pendingMutate = vi.hoisted(() => vi.fn());
const deleteMutate = vi.hoisted(() => vi.fn());
const createMutateAsync = vi.hoisted(() => vi.fn());
const threadProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

function reminder(id: string, title: string, dueDate: string | null, extra: Partial<Reminder> = {}): Reminder {
  return {
    id,
    workspace_id: "ws-1",
    identifier: `MUL-${id}`,
    title,
    description: "",
    creator_type: "member",
    creator_id: "user-1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [{ member_type: "member", member_id: "user-1" }] as Reminder["members"],
    pending_speakers: [],
    unread_count: 0,
    is_direct: false,
    pinned: false,
    status: "todo",
    due_date: dueDate,
    position: 1,
    pending: false,
    ...extra,
  };
}

const reminders: Reminder[] = [
  reminder("r1", "Ship it", "2026-10-08"),
  reminder("r2", "Plan week", "2026-10-05", { status: "done" }),
  reminder("r3", "Write #docs", "2026-10-09"),
  reminder("r4", "Old task", "2026-09-20"),
];
const agents = [
  { id: "a1", name: "Jev", archived_at: null },
  { id: "a2", name: "Old", archived_at: "2026-01-01T00:00:00Z" },
] as Agent[];

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) =>
      options.queryKey[0] === "agents"
        ? { data: agents, isPending: false, isError: false }
        : { data: reminders, isPending: false, isError: false, isFetching: false, refetch: vi.fn() },
  };
});
vi.mock("@multica/ui/hooks/use-mobile", () => ({ useIsMobile: () => isMobile.current }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/group-chats", () => ({ useGroupChatRealtime: () => {} }));
vi.mock("@multica/core/workspace/queries", () => ({ agentListOptions: () => ({ queryKey: ["agents"] }) }));
vi.mock("@multica/core/reminders", () => ({
  reminderListOptions: () => ({ queryKey: ["reminders"] }),
  useReminderRealtime: () => {},
  useCreateReminder: () => ({ mutateAsync: createMutateAsync }),
  useUpdateReminders: () => ({ mutate: updateMutate }),
  useSetRemindersPending: () => ({ mutate: pendingMutate }),
  useDeleteReminders: () => ({ mutate: deleteMutate }),
}));
vi.mock("@multica/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});
vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "user-1" } };
  return {
    useAuthStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});
vi.mock("./chat-thread", () => ({
  ChatThread: (props: Record<string, unknown> & { chat: Reminder; onClose?: () => void }) => {
    threadProps.current = props;
    return (
      <div data-testid="thread">
        {props.chat.title}
        {props.onClose && (
          <button type="button" onClick={props.onClose}>
            close thread
          </button>
        )}
      </div>
    );
  },
}));
vi.mock("./use-group-chat-unread", () => ({ useGroupChatUnreadTotal: () => 0 }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => <span /> }));
vi.mock("../rich-content", () => ({ RichContent: ({ content }: { content: string }) => <span>{content}</span> }));

function renderPage(search = "") {
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/reminder",
    searchParams: new URLSearchParams(search),
    hash: "",
    getShareableUrl: (path) => path,
  };
  const view = renderWithI18n(
    <NavigationProvider value={navigation}>
      <ReminderPage />
    </NavigationProvider>,
  );
  return { navigation, unmount: view.unmount };
}

const day = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 10));
  isMobile.current = false;
  threadProps.current = null;
  updateMutate.mockReset();
  pendingMutate.mockReset();
  deleteMutate.mockReset();
  createMutateAsync.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ReminderPage", () => {
  it("sits between chats and knowledge and lists the week by day, without the chat list", () => {
    const { navigation } = renderPage();
    const rail = screen.getByRole("navigation", { name: "Sections" });
    expect([...rail.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/acme/settings?tab=profile",
      "/acme/im",
      "/acme/reminder",
      "/acme/knowledge",
      "/acme/member",
      "/acme/collect",
      "/acme/settings",
    ]);
    expect(rail.querySelector('[href="/acme/reminder"]')).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "Group chats" })).not.toBeInTheDocument();

    const filters = screen.getByRole("navigation", { name: "Reminder filters" });
    expect(within(filters).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "This week",
      "Today",
      "Open",
      "Completed",
    ]);
    expect(screen.getByRole("heading", { name: "Y2026M10W2" })).toBeInTheDocument();
    expect(within(day("Mon (10/05)")).getByRole("checkbox", { name: 'Mark "Plan week" as not completed' })).toBeChecked();
    expect(day("Sun (10/11)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Old task" })).not.toBeInTheDocument();

    const today = day("Today");
    fireEvent.click(within(today).getByRole("button", { name: "Ship it" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=r1");
    fireEvent.click(within(today).getByRole("checkbox", { name: 'Mark "Ship it" as completed' }));
    expect(updateMutate).toHaveBeenCalledWith([{ id: "r1", patch: { done: true } }], expect.anything());
    fireEvent.click(within(today).getByRole("button", { name: 'Delete "Ship it"' }));
    expect(deleteMutate).toHaveBeenCalledWith(["r1"], expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { name: "Y2026M10W3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to this week" }));
    expect(screen.getByRole("heading", { name: "Y2026M10W2" })).toBeInTheDocument();

    fireEvent.click(within(filters).getByRole("button", { name: "Open" }));
    expect(screen.getByRole("button", { name: "Old task" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan week" })).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole("button", { name: "Completed" }));
    expect(screen.getByRole("button", { name: "Plan week" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ship it" })).not.toBeInTheDocument();
  });

  it("adds under a day, renames on double click, and adds pasted text for today", async () => {
    createMutateAsync.mockResolvedValue(reminder("r9", "Call Ada", "2026-10-08"));
    renderPage();
    const today = day("Today");
    fireEvent.click(within(today).getByRole("button", { name: "Add more" }));
    const field = within(today).getByRole("textbox", { name: "Reminder title" });
    fireEvent.change(field, { target: { value: "  Call Ada " } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(createMutateAsync).toHaveBeenCalledWith({ title: "Call Ada", due_date: "2026-10-08", position: 2 });
    expect(within(today).queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.doubleClick(within(today).getByRole("button", { name: "Ship it" }));
    const rename = within(today).getByRole("textbox", { name: "Reminder title" });
    fireEvent.change(rename, { target: { value: "Ship it today" } });
    fireEvent.keyDown(rename, { key: "Enter" });
    expect(updateMutate).toHaveBeenCalledWith([{ id: "r1", patch: { title: "Ship it today" } }], expect.anything());

    await act(async () => {
      const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(paste, "clipboardData", { value: { getData: () => " Pasted note " } });
      document.dispatchEvent(paste);
    });
    expect(createMutateAsync).toHaveBeenLastCalledWith({ title: "Pasted note", due_date: "2026-10-08", position: 2 });
  });

  it("assigns an agent from @ in the title, without a separate message", async () => {
    createMutateAsync.mockResolvedValue(reminder("r9", "Ask Jev", "2026-10-08"));
    renderPage();
    const today = day("Today");
    fireEvent.click(within(today).getByRole("button", { name: "Add more" }));
    const field = within(today).getByRole("textbox", { name: "Reminder title" });
    fireEvent.change(field, { target: { value: "Ask @Je" } });
    field.setSelectionRange(7, 7);
    fireEvent.keyUp(field, { key: "e" });

    const menu = await screen.findByRole("listbox", { name: "Mention an agent" });
    expect(within(menu).getByRole("option", { name: "Jev" })).toBeInTheDocument();
    expect(within(menu).queryByRole("option", { name: "Old" })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: "Jev" }));
    expect(field).toHaveValue("Ask @Jev ");

    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(createMutateAsync).toHaveBeenCalledWith({
      title: "Ask [@Jev](mention://agent/a1)",
      due_date: "2026-10-08",
      position: 2,
    });

    await act(async () => {
      const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(paste, "clipboardData", { value: { getData: () => "@Jev draft the note" } });
      document.dispatchEvent(paste);
    });
    expect(createMutateAsync).toHaveBeenLastCalledWith({
      title: "[@Jev](mention://agent/a1) draft the note",
      due_date: "2026-10-08",
      position: 2,
    });
  });

  it("moves, pins, and deletes from a reminder's context menu", async () => {
    renderPage();
    fireEvent.contextMenu(within(day("Today")).getByRole("button", { name: "Ship it" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to tomorrow" }));
    expect(updateMutate).toHaveBeenCalledWith(
      [{ id: "r1", patch: { due_date: "2026-10-09", position: 2 } }],
      expect.anything(),
    );

    fireEvent.contextMenu(within(day("Today")).getByRole("button", { name: "Ship it" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin as pending" }));
    expect(pendingMutate).toHaveBeenCalledWith({ ids: ["r1"], pending: true }, expect.anything());

    fireEvent.contextMenu(within(day("Today")).getByRole("button", { name: "Ship it" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(deleteMutate).toHaveBeenCalledWith(["r1"], expect.anything());
  });

  it("filters by tag and hides completed reminders behind a count", () => {
    renderPage();
    const tags = screen.getByRole("group", { name: "Tags" });
    const docs = within(tags).getByRole("button", { name: /#docs/ });
    expect(docs).toHaveTextContent("0/1");
    fireEvent.click(docs);
    expect(docs).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Ship it" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write #docs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear tag filter" }));
    expect(screen.getByRole("button", { name: "Ship it" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide completed" }));
    expect(screen.queryByRole("button", { name: "Plan week" })).not.toBeInTheDocument();
    expect(within(day("Mon (10/05)")).getByLabelText("1 completed")).toBeInTheDocument();
  });

  it("opens the reminder's messages in a resizable column that mentions any active agent", () => {
    const { navigation } = renderPage("item=r1");
    expect(screen.getByTestId("thread")).toHaveTextContent("Ship it");
    expect(threadProps.current?.mentionCandidates).toEqual([{ type: "agent", id: "a1", name: "Jev" }]);
    expect(screen.getByRole("separator", { name: "Resize reminder messages" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close thread" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/reminder");
  });

  it("is its own tab on phones and opens a reminder as its own level", () => {
    isMobile.current = true;
    const list = renderPage();
    const tabs = screen.getByRole("navigation", { name: "Sections" });
    expect(within(tabs).getByRole("link", { name: "Reminders" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "Contacts and favorites" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ship it" }));
    expect(list.navigation.push).toHaveBeenCalledWith("/acme/reminder?item=r1");
    list.unmount();

    renderPage("item=r1");
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    expect(threadProps.current?.mobileNav).toMatchObject({ backHref: "/acme/reminder", backLabel: "Reminders" });
    expect(threadProps.current?.onClose).toBeUndefined();
  });
});
