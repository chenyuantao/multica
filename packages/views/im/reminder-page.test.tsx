// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { Agent, Reminder } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { ReminderPage } from "./reminder-page";
import { rememberReminderOpen, resetReminderOpenMemory } from "./reminder-session";

const isMobile = vi.hoisted(() => ({ current: false }));
const appForeground = vi.hoisted(() => ({ value: true }));
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

const reminderSource = vi.hoisted(() => ({ items: undefined as Reminder[] | undefined }));

const seedReminders = (): Reminder[] => [
  reminder("r1", "Ship it", "2026-10-08"),
  reminder("r2", "Plan week", "2026-10-05", { status: "done" }),
  reminder("r3", "Write #docs", "2026-10-09"),
  reminder("r4", "Old task", "2026-09-20"),
];
let reminders = seedReminders();
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
        : {
            data: reminderSource.items ?? reminders,
            isPending: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
          },
  };
});
vi.mock("@multica/ui/hooks/use-mobile", () => ({ useIsMobile: () => isMobile.current }));
vi.mock("../common/use-app-foreground", () => ({ useAppForeground: () => appForeground.value }));
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
  appForeground.value = true;
  threadProps.current = null;
  updateMutate.mockReset();
  pendingMutate.mockReset();
  deleteMutate.mockReset();
  createMutateAsync.mockReset();
  reminderSource.items = undefined;
  reminders = seedReminders();
  resetReminderOpenMemory();
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

  it("adds under a day, opens that conversation, renames on double click, and adds pasted text for today", async () => {
    const { navigation } = renderPage();
    createMutateAsync.mockImplementation(async (input: { title: string; due_date: string }) => {
      const created = reminder("r9", input.title, input.due_date);
      reminders = [...reminders, created];
      return created;
    });
    const today = day("Today");
    fireEvent.click(within(today).getByRole("button", { name: "Add more" }));
    const field = within(today).getByRole("textbox", { name: "Reminder title" });
    fireEvent.change(field, { target: { value: "  Call Ada " } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(createMutateAsync).toHaveBeenCalledWith({ title: "Call Ada", due_date: "2026-10-08", position: 2 });
    expect(within(today).queryByRole("textbox")).not.toBeInTheDocument();
    expect(navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=r9");
    expect(screen.getByTestId("thread")).toHaveTextContent("Call Ada");
    expect(threadProps.current?.focusComposer).toBe(true);
    expect(within(today).getByRole("button", { name: "Call Ada" })).toHaveAttribute("aria-current", "true");

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

  it("opens the new conversation before the list query includes the reminder", async () => {
    const { navigation } = renderPage();
    createMutateAsync.mockResolvedValue(reminder("r10", "Before the list", "2026-10-08"));
    const today = day("Today");
    fireEvent.click(within(today).getByRole("button", { name: "Add more" }));
    const field = within(today).getByRole("textbox", { name: "Reminder title" });
    fireEvent.change(field, { target: { value: "Before the list" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=r10");
    expect(screen.getByTestId("thread")).toHaveTextContent("Before the list");
    expect(threadProps.current?.focusComposer).toBe(true);
  });

  it("opens a new reminder when the current week, filter, or phone list would hide it", async () => {
    const paste = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
      document.dispatchEvent(event);
    };
    createMutateAsync.mockImplementation(async (input: { title: string; due_date: string }) => {
      const created = reminder(`new-${reminders.length}`, input.title, input.due_date);
      reminders = [...reminders, created];
      return created;
    });

    const nextWeek = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await act(async () => {
      paste("From next week");
    });
    expect(nextWeek.navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=new-4");
    expect(screen.getByRole("heading", { name: "Y2026M10W2" })).toBeInTheDocument();
    expect(screen.getByTestId("thread")).toHaveTextContent("From next week");
    expect(screen.getByRole("button", { name: "From next week" })).toHaveAttribute("aria-current", "true");
    nextWeek.unmount();

    reminders = seedReminders();
    resetReminderOpenMemory();
    const completed = renderPage();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Reminder filters" })).getByRole("button", { name: "Completed" }));
    await act(async () => {
      paste("From completed");
    });
    expect(completed.navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=new-4");
    expect(screen.getByRole("heading", { name: "Y2026M10W2" })).toBeInTheDocument();
    expect(screen.getByTestId("thread")).toHaveTextContent("From completed");
    completed.unmount();

    reminders = seedReminders();
    resetReminderOpenMemory();
    const tagged = renderPage();
    fireEvent.click(within(screen.getByRole("group", { name: "Tags" })).getByRole("button", { name: /#docs/ }));
    expect(screen.queryByRole("button", { name: "Ship it" })).not.toBeInTheDocument();
    await act(async () => {
      paste("Untagged");
    });
    expect(tagged.navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=new-4");
    expect(screen.getByRole("button", { name: "Ship it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Untagged" })).toHaveAttribute("aria-current", "true");
    tagged.unmount();

    reminders = seedReminders();
    resetReminderOpenMemory();
    isMobile.current = true;
    const phone = renderPage();
    await act(async () => {
      paste("On phone");
    });
    expect(phone.navigation.push).toHaveBeenCalledWith("/acme/reminder?item=new-4");
    expect(phone.navigation.replace).not.toHaveBeenCalled();
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

  it("clears the unread badge on the open conversation and keeps the others", () => {
    reminderSource.items = [
      reminder("r1", "Ship it", "2026-10-08", { unread_count: 4 }),
      reminder("r3", "Write #docs", "2026-10-09", { unread_count: 2 }),
    ];
    const view = renderPage();
    expect(screen.queryByLabelText("4 unread messages")).not.toBeInTheDocument();
    expect(screen.getByLabelText("2 unread messages")).toHaveTextContent("2");
    view.unmount();

    appForeground.value = false;
    renderPage();
    expect(screen.getByLabelText("4 unread messages")).toHaveTextContent("4");
  });

  it("keeps the badge on the phone list after the conversation was left", () => {
    isMobile.current = true;
    rememberReminderOpen("ws-1", "r1");
    reminderSource.items = [reminder("r1", "Ship it", "2026-10-08", { unread_count: 4 })];
    renderPage();
    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
    expect(screen.getByLabelText("4 unread messages")).toHaveTextContent("4");
  });

  it("shows the unread badge again while the reminder page is held off screen", () => {
    reminderSource.items = [reminder("r1", "Ship it", "2026-10-08", { unread_count: 4 })];
    function Harness({ active }: { active: boolean }) {
      const navigation: NavigationAdapter = {
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
        pathname: "/acme/reminder",
        searchParams: new URLSearchParams(),
        hash: "",
        getShareableUrl: (path) => path,
      };
      return (
        <NavigationProvider value={navigation}>
          <ReminderPage active={active} />
        </NavigationProvider>
      );
    }
    const view = renderWithI18n(<Harness active />);
    expect(screen.queryByLabelText("4 unread messages")).not.toBeInTheDocument();
    view.rerender(<Harness active={false} />);
    expect(screen.getByLabelText("4 unread messages")).toHaveTextContent("4");
  });

  it("opens today's incomplete reminder and scrolls it into view", () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const { navigation } = renderPage();
      expect(navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=r1");
      expect(screen.getByTestId("thread")).toHaveTextContent("Ship it");
      expect(threadProps.current?.focusComposer).toBe(false);
      const row = document.querySelector('[data-reminder-id="r1"]');
      expect(scroll.mock.instances).toContain(row);
      expect(scroll).toHaveBeenCalledWith({ block: "center" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("opens the nearest incomplete reminder when today has none, including a later week", () => {
    reminderSource.items = [
      reminder("y", "Yesterday", "2026-10-07"),
      reminder("t", "Today done", "2026-10-08", { status: "done" }),
      reminder("n", "Tomorrow", "2026-10-09"),
    ];
    const nearest = renderPage();
    expect(nearest.navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=y");
    expect(screen.getByTestId("thread")).toHaveTextContent("Yesterday");
    nearest.unmount();
    resetReminderOpenMemory();

    reminderSource.items = [reminder("far", "Later", "2026-10-20")];
    const { navigation } = renderPage();
    expect(navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=far");
    expect(screen.getByRole("heading", { name: "Y2026M10W3" })).toBeInTheDocument();
  });

  it("reopens the same conversation after the page remounts, and stays closed once dismissed", () => {
    const first = renderPage();
    expect(first.navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=r1");
    first.unmount();

    reminderSource.items = [
      reminder("r1", "Ship it", "2026-10-08", { status: "done" }),
      reminder("closer", "Closer", "2026-10-08"),
    ];
    const again = renderPage();
    expect(again.navigation.replace).toHaveBeenCalledWith("/acme/reminder?item=r1");
    expect(again.navigation.replace).not.toHaveBeenCalledWith("/acme/reminder?item=closer");
    expect(screen.getByTestId("thread")).toHaveTextContent("Ship it");
    again.unmount();
    resetReminderOpenMemory();

    const opened = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "close thread" }));
    expect(opened.navigation.replace).toHaveBeenLastCalledWith("/acme/reminder");
    opened.unmount();

    const closed = renderPage();
    expect(closed.navigation.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
  });

  it("keeps the opened conversation mounted while another section is showing", () => {
    function Harness({ active }: { active: boolean }) {
      const navigation: NavigationAdapter = {
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
        pathname: active ? "/acme/reminder" : "/acme/im",
        searchParams: new URLSearchParams(),
        hash: "",
        getShareableUrl: (path) => path,
      };
      return (
        <NavigationProvider value={navigation}>
          <ReminderPage active={active} />
        </NavigationProvider>
      );
    }
    const view = renderWithI18n(<Harness active />);
    expect(screen.getByTestId("thread")).toHaveTextContent("Ship it");

    view.rerender(<Harness active={false} />);
    expect(screen.getByTestId("thread")).toHaveTextContent("Ship it");

    reminderSource.items = [
      reminder("r1", "Ship it", "2026-10-08", { status: "done" }),
      reminder("closer", "Closer", "2026-10-08"),
    ];
    view.rerender(<Harness active />);
    expect(screen.getByTestId("thread")).toHaveTextContent("Ship it");
    expect(screen.getByTestId("thread")).not.toHaveTextContent("Closer");
  });

  it("does not open a reminder level on a phone", () => {
    isMobile.current = true;
    const { navigation } = renderPage();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
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
