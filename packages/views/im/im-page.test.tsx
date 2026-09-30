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

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn((options: { queryKey?: unknown[] }) => ({
      data: options?.queryKey?.[0] === "group-chats" ? chatsRef.current : [],
      isLoading: false,
      isError: false,
    })),
  };
});
vi.mock("@multica/ui/hooks/use-mobile", () => ({ useIsMobile: () => isMobileRef.current }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
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
vi.mock("@multica/core/group-chats", () => ({
  groupChatListOptions: () => ({ queryKey: ["group-chats"] }),
  useGroupChatRealtime: () => {},
}));
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
vi.mock("./im-rail", () => ({ ImRail: () => null }));
vi.mock("./chat-sidebar", () => ({ ChatSidebar: () => null, ChatAvatar: () => null }));
vi.mock("./chat-thread", () => ({
  ChatThread: ({ mobileNav }: { mobileNav?: { onOpenProfile: (type: string, id: string) => void } }) => (
    <button type="button" onClick={() => mobileNav?.onOpenProfile("member", "user-2")}>
      thread author
    </button>
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
  isMobileRef.current = true;
  chatsRef.current = [chat];
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

  it("drops the tab bar once a level is pushed", () => {
    renderPage("chats", "chat=c1");
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
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
