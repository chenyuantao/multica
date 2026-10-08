// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { MessageCollection } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { encodeChatHistory } from "./chat-history";
import { formatStamp } from "./im-utils";
import { CollectPage } from "./collect-page";

const isMobile = vi.hoisted(() => ({ current: false }));
const deleteMutate = vi.hoisted(() => vi.fn());
const history = encodeChatHistory({
  messages: [{ author_name: "Ada", content: "first saved line\nmore", created_at: "2026-01-01T00:00:00Z" }],
});
const items: MessageCollection[] = [
  {
    id: "c1",
    workspace_id: "ws-1",
    content: history,
    source_title: "Design",
    sender_name: "Ada",
    created_at: "2026-10-02T00:00:00Z",
  },
  {
    id: "c2",
    workspace_id: "ws-1",
    content: "Only the first line\nhidden",
    source_title: "Launch",
    sender_name: "Grace",
    created_at: "2026-10-01T00:00:00Z",
  },
];

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => ({ data: items, isLoading: false, isError: false }),
  };
});
vi.mock("@multica/ui/hooks/use-mobile", () => ({ useIsMobile: () => isMobile.current }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/collections", () => ({
  messageCollectionListOptions: () => ({ queryKey: ["message-collections"] }),
  useDeleteMessageCollection: () => ({ mutate: deleteMutate, isPending: false }),
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
vi.mock("./im-sidebar-search", () => ({
  ImSidebarSearch: () => <input aria-label="Search" />,
}));
vi.mock("./use-group-chat-unread", () => ({ useGroupChatUnreadTotal: () => 0 }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => <span /> }));

function renderPage(search = "") {
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/collect",
    searchParams: new URLSearchParams(search),
    hash: "",
    getShareableUrl: (path) => path,
  };
  const view = renderWithI18n(
    <NavigationProvider value={navigation}>
      <CollectPage />
    </NavigationProvider>,
  );
  return { navigation, unmount: view.unmount };
}

beforeEach(() => {
  isMobile.current = false;
  deleteMutate.mockReset();
});

describe("CollectPage", () => {
  it("puts favorites last in the desktop rail sections and expands a saved history", () => {
    renderPage();
    const rail = screen.getByRole("navigation", { name: "Sections" });
    expect([...rail.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/acme/settings?tab=profile",
      "/acme/im",
      "/acme/member",
      "/acme/knowledge",
      "/acme/reminder",
      "/acme/collect",
      "/acme/settings",
    ]);
    expect(rail.querySelector('[href="/acme/collect"]')).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();

    const rows = screen.getAllByRole("button", { name: /Design|Launch/ });
    expect(rows[0]).toHaveTextContent("first saved line");
    expect(rows[0]).toHaveTextContent("Design");
    expect(rows[0]).toHaveTextContent("Ada");
    expect(rows[0]).toHaveTextContent(formatStamp(items[0]!.created_at, new Date(), (time) => `Yesterday ${time}`));
    expect(rows[1]).toHaveTextContent("Only the first line");
    expect(rows[1]).not.toHaveTextContent("hidden");
    expect(rows[1]).toHaveTextContent("Grace");

    expect(screen.getByRole("heading", { name: "Design" })).toBeInTheDocument();
    expect(screen.getByText(/more/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chat History/ })).not.toBeInTheDocument();
  });

  it("removes a favorite from the list menu", () => {
    renderPage();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Launch/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(deleteMutate).toHaveBeenCalledWith("c2", expect.any(Object));
  });

  it("keeps favorites inside Me on a phone", () => {
    isMobile.current = true;
    const list = renderPage();
    const bottom = screen.getByRole("navigation", { name: "Sections" });
    expect([...bottom.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "Chats",
      "Contacts",
      "Knowledge",
      "Me",
    ]);
    expect(bottom.querySelector('[href="/acme/settings"]')).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("textbox", { name: "Search" })).not.toBeInTheDocument();
    const mine = screen.getByRole("navigation", { name: "Settings, reminders, and favorites" });
    expect(mine.querySelector('[href="/acme/collect"]')).toHaveAttribute("aria-current", "page");

    list.unmount();
    const { navigation } = renderPage("item=c1");
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Design" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/collect");
  });
});
