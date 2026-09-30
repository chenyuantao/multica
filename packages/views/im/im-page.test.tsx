// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import type { DirectoryEntry } from "./use-chat-directory";

const mockModalOpen = vi.hoisted(() => vi.fn());
const isMobileRef = vi.hoisted(() => ({ current: true }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: vi.fn(() => ({ data: [], isLoading: false, isError: false })) };
});
vi.mock("@multica/ui/hooks/use-mobile", () => ({ useIsMobile: () => isMobileRef.current }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "user-1" } };
  return {
    useAuthStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }),
  };
});
vi.mock("@multica/core/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/paths")>()),
  useWorkspacePaths: () => ({
    im: () => "/acme/im",
    imChat: (id: string) => `/acme/im?chat=${id}`,
    imChatSettings: (id: string) => `/acme/im?chat=${id}&view=settings`,
    agentDetail: (id: string) => `/acme/agents/${id}`,
    memberDetail: (id: string) => `/acme/members/${id}`,
  }),
}));
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
vi.mock("./chat-thread", () => ({ ChatThread: () => null }));
vi.mock("./chat-details-panel", () => ({ ChatDetailsPanel: () => null }));
vi.mock("./new-chat-dialog", () => ({ NewChatDialog: () => null }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));

import { ImPage } from "./im-page";

function renderContacts() {
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/member",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
  renderWithI18n(
    <NavigationProvider value={navigation}>
      <ImPage view="contacts" />
    </NavigationProvider>,
  );
  return navigation;
}

beforeEach(() => {
  mockModalOpen.mockReset();
  isMobileRef.current = true;
});

describe("ImPage contacts on mobile", () => {
  it("opens an agent contact in the detail modal without navigating", () => {
    const navigation = renderContacts();
    fireEvent.click(screen.getByRole("button", { name: /Lambda/ }));

    expect(mockModalOpen).toHaveBeenCalledWith("agent-detail", { agentId: "agent-1", hostPathname: "/acme/member" });
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("still routes a person contact to the member page", () => {
    const navigation = renderContacts();
    fireEvent.click(screen.getByRole("button", { name: /Ada/ }));

    expect(navigation.push).toHaveBeenCalledWith("/acme/members/user-2");
    expect(mockModalOpen).not.toHaveBeenCalled();
  });

  it("opens the create-agent modal from the contacts header without navigating", () => {
    const navigation = renderContacts();
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));

    expect(mockModalOpen).toHaveBeenCalledWith("create-agent");
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
