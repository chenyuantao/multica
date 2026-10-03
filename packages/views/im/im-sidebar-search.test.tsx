// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DocNode, GroupChat, GroupChatSearchHit } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import type { DirectoryEntry } from "./use-chat-directory";
import type { SearchSection } from "./im-search-utils";

const node = (path: string, extra: Partial<DocNode> = {}): DocNode => ({
  name: path.split("/").pop() ?? path,
  path,
  type: "file",
  child_count: 0,
  modified_at: null,
  children: [],
  match: "content",
  snippet: "",
  hits: 1,
  ...extra,
});
const dir = (path: string, children: DocNode[]): DocNode => ({ ...node(path), type: "dir", children, match: "" });
const chat = (id: string, title: string, lastAt: string): GroupChat =>
  ({ id, title, created_at: "2026-01-01T00:00:00Z", last_comment_at: lastAt, members: [], is_direct: false }) as unknown as GroupChat;

const tree = [node("readme.md", { modified_at: "2026-02-01T00:00:00Z" })];
const chats = [1, 2, 3, 4, 5].map((n) => chat(`room-${n}`, `Room ${n}`, `2026-0${n}-01T00:00:00Z`));
const chatHits: GroupChatSearchHit[] = [];
const noteHits = [dir("Deep", [node("Deep/Roadmap.md", { match: "title" })])];
const people: DirectoryEntry[] = [{ type: "member", id: "u2", name: "Ada", detail: "roadmap owner" }];
const agents: DirectoryEntry[] = [{ type: "agent", id: "a1", name: "Roadmapper", detail: "" }];

vi.mock("@multica/core/docs", () => ({
  docsTreeOptions: () => ({ queryKey: ["docs", "tree"] }),
  docsSearchOptions: (q: string) => ({ queryKey: ["docs", "search", q] }),
}));
vi.mock("@multica/core/group-chats", async () => ({
  directChatPeer: (await vi.importActual<typeof import("@multica/core/group-chats")>("@multica/core/group-chats")).directChatPeer,
  groupChatListOptions: () => ({ queryKey: ["group-chats", "list"] }),
  groupChatSearchOptions: (_wsId: string, q: string) => ({ queryKey: ["group-chats", "search", q] }),
}));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  const ok = (data: unknown) => ({ data, isError: false, error: null, isFetching: false, isPlaceholderData: false });
  return {
    ...actual,
    useQuery: vi.fn(({ queryKey }: { queryKey: string[] }) => {
      const [root, kind, q] = queryKey;
      if (root === "group-chats") return kind === "list" ? ok(chats) : ok(q ? { query: q, hits: chatHits } : undefined);
      if (kind === "tree") return ok(tree);
      if (!q) return ok(undefined);
      return ok({ query: q, nodes: noteHits, truncated: false });
    }),
  };
});
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "u1" } };
  return {
    useAuthStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }),
  };
});
vi.mock("@multica/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});
vi.mock("@multica/core/workspace/hooks", () => ({ useActorName: () => ({ getActorName: () => "Someone" }) }));
vi.mock("./use-chat-directory", async () => {
  const actual = await vi.importActual<typeof import("./use-chat-directory")>("./use-chat-directory");
  return { ...actual, useChatDirectory: () => ({ people, agents, byKey: new Map(), agentList: [] }) };
});
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));

import { ImSidebarSearch } from "./im-sidebar-search";

const headings = () => [...document.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent);
const optionTexts = (group: HTMLElement) => within(group).getAllByRole("option").map((option) => option.textContent);

function renderSearch(priority: SearchSection, locale?: "zh-Hans") {
  const onOpenChat = vi.fn();
  const onOpenContact = vi.fn();
  const onOpenNote = vi.fn();
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/im",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
  renderWithI18n(
    <NavigationProvider value={navigation}>
      <ImSidebarSearch priority={priority} onOpenChat={onOpenChat} onOpenContact={onOpenContact} onOpenNote={onOpenNote} />
    </NavigationProvider>,
    locale ? { locale } : undefined,
  );
  return { onOpenChat, onOpenContact, onOpenNote, navigation };
}

async function typeQuery(value: string) {
  const input = screen.getByRole("combobox", { name: "Search" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  await waitFor(() => expect(screen.getAllByRole("option").some((option) => option.getAttribute("aria-disabled") !== "true")).toBe(true));
  return input;
}

describe("ImSidebarSearch", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("opens a dropdown of every section, with the page's section first and no Ask AI row", async () => {
    renderSearch("notes");
    const input = screen.getByRole("combobox", { name: "Search" });
    expect(input).toHaveAttribute("placeholder", "Search");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.focus(input);
    expect(await screen.findByRole("group", { name: "Recently modified notes" })).toBeInTheDocument();
    expect(headings()[0]).toBe("Recently modified notes");
    expect(screen.queryByRole("option", { name: /Ask AI/ })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();

    await typeQuery("r");
    expect(headings()).toEqual(["Notes", "Chats", "Contacts"]);
  });

  it("leads with contacts from the member page", async () => {
    renderSearch("contacts");
    await typeQuery("r");
    expect(headings()).toEqual(["Contacts", "Chats", "Notes"]);
  });

  it("uses the page names and collapses each section after three rows", async () => {
    renderSearch("chats", "zh-Hans");
    const input = screen.getByRole("combobox", { name: "搜索" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "room" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "查看全部（5）" })).toBeInTheDocument());

    expect(headings()[0]).toBe("会话");
    const chatOptions = () => optionTexts(screen.getByRole("group", { name: "会话" }));
    expect(chatOptions().filter((text) => text?.startsWith("Room"))).toHaveLength(3);

    fireEvent.click(screen.getByRole("option", { name: "查看全部（5）" }));
    expect(chatOptions().filter((text) => text?.startsWith("Room"))).toHaveLength(5);
    expect(screen.queryByRole("option", { name: "查看全部（5）" })).toBeNull();
  });

  it("opens the chosen chat and closes the dropdown", async () => {
    const { onOpenChat } = renderSearch("chats");
    await typeQuery("room");
    fireEvent.click(screen.getAllByRole("option").find((option) => option.textContent?.startsWith("Room"))!);
    expect(onOpenChat).toHaveBeenCalledWith("room-5");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
