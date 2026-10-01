// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import type { DirectoryEntry } from "./use-chat-directory";

const mockModalOpen = vi.hoisted(() => vi.fn());
const isMobileRef = vi.hoisted(() => ({ current: true }));
const chatsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const unreadTotalRef = vi.hoisted(() => ({ current: 0 }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ getQueryData: () => undefined }),
    useQuery: vi.fn((options: { queryKey?: unknown[] }) => ({
      data: options?.queryKey?.[0] === "group-chats" ? chatsRef.current : [],
      isLoading: false,
      isError: false,
    })),
  };
});
vi.mock("@multica/ui/hooks/use-mobile", () => ({ useIsMobile: () => isMobileRef.current }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/workspace/hooks", () => ({ useActorName: () => ({ getActorName: () => "Someone" }) }));
vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "user-1" } };
  return {
    useAuthStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }),
  };
});
vi.mock("@multica/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});
vi.mock("@multica/core/group-chats", async () => ({
  directChatPeer: (await vi.importActual<typeof import("@multica/core/group-chats")>("@multica/core/group-chats")).directChatPeer,
  groupChatListOptions: () => ({ queryKey: ["group-chats"] }),
  groupChatKeys: { messages: (wsId: string, chatId: string) => ["group-chats", wsId, "messages", chatId] },
  useGroupChatRealtime: () => {},
  useSetGroupChatPinned: () => ({ mutate: vi.fn() }),
}));
const startDirectChat = vi.hoisted(() => vi.fn());
vi.mock("./use-direct-chat", () => ({ useStartDirectChat: () => ({ start: startDirectChat, isPending: false }) }));
vi.mock("@multica/core/modals", () => ({
  useModalStore: Object.assign(vi.fn(), { getState: () => ({ open: mockModalOpen }) }),
}));

const agent: DirectoryEntry = { type: "agent", id: "agent-1", name: "Lambda", detail: "" };
const person: DirectoryEntry = { type: "member", id: "user-2", name: "Ada", detail: "ada@example.com" };
vi.mock("./use-chat-directory", async () => {
  const actual = await vi.importActual<typeof import("./use-chat-directory")>("./use-chat-directory");
  return {
    ...actual,
    useChatDirectory: () => ({
      people: [person],
      agents: [agent],
      byKey: new Map([
        ["agent:agent-1", agent],
        ["member:user-2", person],
      ]),
      agentList: [],
    }),
  };
});
vi.mock("./use-group-chat-unread", () => ({ useGroupChatUnreadTotal: () => unreadTotalRef.current }));
vi.mock("./im-rail", () => ({ ImRail: () => null }));
vi.mock("./chat-sidebar", () => ({
  ChatSidebar: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect("c1")}>
      select chat
    </button>
  ),
  ChatAvatar: () => null,
}));
vi.mock("./chat-thread", () => ({
  ChatThread: ({ mobileNav }: { mobileNav?: { settingsHref: string; onOpenProfile: (type: string, id: string) => void } }) => (
    <>
      <button type="button" onClick={() => mobileNav?.onOpenProfile("member", "user-2")}>
        thread author
      </button>
      <a href={mobileNav?.settingsHref}>thread settings</a>
    </>
  ),
}));
vi.mock("./chat-details-panel", () => ({
  ChatDetailsPanel: ({ onOpenMember }: { onOpenMember?: (m: { member_type: string; member_id: string }) => void }) => (
    <button type="button" onClick={() => onOpenMember?.({ member_type: "agent", member_id: "agent-1" })}>
      settings agent
    </button>
  ),
}));
vi.mock("./new-chat-dialog", () => ({ NewChatDialog: () => null }));
vi.mock("./im-search-dialog", () => ({ ImSearchDialog: () => null }));
vi.mock("./contact-card", () => ({ ContactCard: ({ entry }: { entry: DirectoryEntry }) => <p>{`card ${entry.name}`}</p> }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("../agents/components/agent-detail-page", () => ({
  AgentDetail: ({ agentId, presentation }: { agentId: string; presentation: string }) => (
    <p>{`agent ${agentId} ${presentation}`}</p>
  ),
}));
vi.mock("../members/member-detail-page", () => ({
  MemberDetailPage: ({ userId, embedded }: { userId: string; embedded?: boolean }) => (
    <p>{`member ${userId}${embedded ? " embedded" : ""}`}</p>
  ),
}));

import { ImPage } from "./im-page";

const chat = { id: "c1", title: "Launch", members: [], created_at: "2026-01-01T00:00:00Z" } as unknown as GroupChat;

function renderPage(view: "chats" | "contacts", search = "", canGoBack?: () => boolean) {
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: view === "contacts" ? "/acme/member" : "/acme/im",
    searchParams: new URLSearchParams(search),
    hash: "",
    getShareableUrl: (path) => path,
    canGoBack,
  };
  renderWithI18n(
    <NavigationProvider value={navigation}>
      <ImPage view={view} />
    </NavigationProvider>,
  );
  return navigation;
}

beforeEach(() => {
  mockModalOpen.mockReset();
  startDirectChat.mockReset();
  isMobileRef.current = true;
  chatsRef.current = [chat];
  unreadTotalRef.current = 0;
});

describe("ImPage tab roots on mobile", () => {
  it("shows the four section tabs under the chat list", () => {
    renderPage("chats");
    const tabs = screen.getByRole("navigation", { name: "Sections" });
    const links = [...tabs.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);

    expect(links).toEqual([
      ["Chats", "/acme/im"],
      ["Contacts", "/acme/member"],
      ["Knowledge", "/acme/knowledge"],
      ["Me", "/acme/settings"],
    ]);
    expect(screen.getByRole("link", { name: "Chats" })).toHaveAttribute("aria-current", "page");
  });

  it("badges the Chats tab with the unread message total", () => {
    unreadTotalRef.current = 120;
    renderPage("chats");
    expect(screen.getByLabelText("120 unread messages")).toHaveTextContent("99+");
  });

  it("drops the tab bar once a level is pushed", () => {
    renderPage("chats", "chat=c1");
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
  });
});

describe("ImPage contacts on desktop", () => {
  beforeEach(() => {
    isMobileRef.current = false;
  });

  it("puts the picked contact in the URL so other pages can open it", () => {
    const navigation = renderPage("contacts");
    fireEvent.click(screen.getByRole("button", { name: /Lambda/ }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/member?contact=agent%3Aagent-1");
  });

  it("shows the contact named by the URL", () => {
    renderPage("contacts", "contact=member:user-2");
    expect(screen.getByText("card Ada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ada/ })).toHaveAttribute("aria-current", "true");
  });
});

describe("ImPage contacts on mobile", () => {
  it("pushes an agent contact as a profile level instead of the modal", () => {
    const navigation = renderPage("contacts");
    fireEvent.click(screen.getByRole("button", { name: /Lambda/ }));

    expect(navigation.push).toHaveBeenCalledWith("/acme/member?contact=agent%3Aagent-1");
    expect(mockModalOpen).not.toHaveBeenCalled();
  });

  it("pushes a person contact as a profile level instead of the dashboard page", () => {
    const navigation = renderPage("contacts");
    fireEvent.click(screen.getByRole("button", { name: /Ada/ }));

    expect(navigation.push).toHaveBeenCalledWith("/acme/member?contact=member%3Auser-2");
  });

  it("renders the embedded profile with only a way back to contacts", () => {
    const navigation = renderPage("contacts", "contact=agent:agent-1");

    expect(screen.getByText("agent agent-1 embedded")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to contacts" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/member");
  });

  it("messages a contact from the profile header, but not yourself", () => {
    renderPage("contacts", "contact=agent:agent-1");
    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    expect(startDirectChat).toHaveBeenCalledWith({ member_type: "agent", member_id: "agent-1" });
  });

  it("offers no message action on your own profile", () => {
    renderPage("contacts", "contact=member:user-1");
    expect(screen.queryByRole("button", { name: "Message" })).not.toBeInTheDocument();
  });

  it("opens the create-agent modal from the contacts header without navigating", () => {
    const navigation = renderPage("contacts");
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));

    expect(mockModalOpen).toHaveBeenCalledWith("create-agent");
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("ImPage chat levels on mobile", () => {
  it("pushes a thread author's profile as the next level", () => {
    const navigation = renderPage("chats", "chat=c1");
    fireEvent.click(screen.getByRole("button", { name: "thread author" }));

    expect(navigation.push).toHaveBeenCalledWith("/acme/im?chat=c1&contact=member%3Auser-2");
  });

  it("links a group chat's menu to its settings", () => {
    renderPage("chats", "chat=c1");
    expect(screen.getByRole("link", { name: "thread settings" })).toHaveAttribute("href", "/acme/im?chat=c1&view=settings");
  });

  it("links a direct chat's menu to the other side's profile", () => {
    chatsRef.current = [{
      ...chat,
      is_direct: true,
      members: [
        { member_type: "member", member_id: "user-1" },
        { member_type: "agent", member_id: "agent-1" },
      ],
    }];
    renderPage("chats", "chat=c1");
    expect(screen.getByRole("link", { name: "thread settings" })).toHaveAttribute("href", "/acme/im?chat=c1&contact=agent%3Aagent-1");
  });

  it("pushes an agent from chat settings as the fourth level", () => {
    const navigation = renderPage("chats", "chat=c1&view=settings");
    fireEvent.click(screen.getByRole("button", { name: "settings agent" }));

    expect(navigation.push).toHaveBeenCalledWith("/acme/im?chat=c1&view=settings&contact=agent%3Aagent-1");
  });

  it("returns from a settings profile to the chat settings", () => {
    const navigation = renderPage("chats", "chat=c1&view=settings&contact=agent:agent-1");

    expect(screen.getByText("agent agent-1 embedded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat settings" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/im?chat=c1&view=settings");
  });

  it("steps back through history when the level was pushed in-app", () => {
    const navigation = renderPage("chats", "chat=c1&contact=member:user-2", () => true);

    expect(screen.getByText("member user-2 embedded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(navigation.back).toHaveBeenCalled();
  });
});

describe("ImPage chat list still opens the conversation", () => {
  it("pushes the thread from the mobile chat list", () => {
    const navigation = renderPage("chats");
    fireEvent.click(screen.getByRole("button", { name: "select chat" }));
    expect(navigation.push).toHaveBeenCalledWith("/acme/im?chat=c1");
  });

  it("replaces into the thread from the desktop chat list", () => {
    isMobileRef.current = false;
    const navigation = renderPage("chats");
    fireEvent.click(screen.getByRole("button", { name: "select chat" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/im?chat=c1");
  });
});

describe("ImPage group details from contacts", () => {
  it("opens a group's details from the mobile contacts list", () => {
    const navigation = renderPage("contacts");
    fireEvent.click(screen.getByRole("button", { name: /Launch/ }));
    expect(navigation.push).toHaveBeenCalledWith("/acme/member?chat=c1");
  });

  it("shows the details and a way into the conversation on mobile", () => {
    const navigation = renderPage("contacts", "chat=c1");
    expect(screen.getByRole("button", { name: "settings agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open chat" })).toHaveAttribute("href", "/acme/im?chat=c1");
    fireEvent.click(screen.getByRole("button", { name: "settings agent" }));
    expect(navigation.push).toHaveBeenCalledWith("/acme/member?chat=c1&contact=agent%3Aagent-1");
  });

  it("returns from a profile opened in the details to those details", () => {
    const navigation = renderPage("contacts", "chat=c1&contact=agent:agent-1");
    fireEvent.click(screen.getByRole("button", { name: "Back to chat details" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/member?chat=c1");
  });

  it("opens a group's details from the desktop contacts list", () => {
    isMobileRef.current = false;
    const navigation = renderPage("contacts");
    fireEvent.click(screen.getByRole("button", { name: /Launch/ }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/member?chat=c1");
  });

  it("shows the details and a way into the conversation on desktop", () => {
    isMobileRef.current = false;
    renderPage("contacts", "chat=c1");
    expect(screen.getByRole("button", { name: "settings agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "thread author" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open chat" })).toHaveAttribute("href", "/acme/im?chat=c1");
    expect(screen.getByRole("button", { name: /Launch/ })).toHaveAttribute("aria-current", "true");
  });
});
