// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { configureShortcutPlatform } from "@multica/core/shortcuts";
import type { AskAIPage, AskAISelection, DocNode, GroupChat, GroupChatSearchHit } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import type { DirectoryEntry } from "./use-chat-directory";

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

const tree = [dir("Strategy", [node("Strategy/plan.md", { modified_at: "2026-01-01T00:00:00Z" })]), node("readme.md", { modified_at: "2026-02-01T00:00:00Z" })];
const chats = [chat("c-old", "Roadmap", "2026-01-01T00:00:00Z"), chat("c-new", "Standup", "2026-03-01T00:00:00Z")];
const chatHits: GroupChatSearchHit[] = [
  { chat_id: "c-new", message_id: "m1", snippet: "the **roadmap** slipped", message_at: "", hit_count: 4 },
];
const noteHits = [
  dir("Deep", [node("Deep/body.md", { hits: 9, snippet: "roadmap body" }), node("Deep/Roadmap.md", { match: "title" })]),
];
const people: DirectoryEntry[] = [{ type: "member", id: "u2", name: "Ada", detail: "roadmap owner" }];
const agents: DirectoryEntry[] = [{ type: "agent", id: "a1", name: "Roadmapper", detail: "" }];
const docsErrorRef = vi.hoisted(() => ({ current: false }));
const askMutate = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/docs", () => ({
  docsTreeOptions: () => ({ queryKey: ["docs", "tree"] }),
  docsSearchOptions: (q: string) => ({ queryKey: ["docs", "search", q] }),
}));
vi.mock("@multica/core/group-chats", async () => ({
  directChatPeer: (await vi.importActual<typeof import("@multica/core/group-chats")>("@multica/core/group-chats")).directChatPeer,
  groupChatListOptions: () => ({ queryKey: ["group-chats", "list"] }),
  groupChatSearchOptions: (_wsId: string, q: string) => ({ queryKey: ["group-chats", "search", q] }),
  useAskAI: () => ({ mutate: askMutate, isPending: false }),
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
      if (docsErrorRef.current) return { ...ok(undefined), isError: true, error: new Error("unconfigured") };
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

import { ImSearchDialog } from "./im-search-dialog";
import { useAskAILauncher } from "./use-ask-ai-launcher";

const pressOpen = () => fireEvent.keyDown(document, { key: "o", metaKey: true });
const optionTexts = (group: HTMLElement) => within(group).getAllByRole("option").map((o) => o.textContent);

type HarnessProps = Omit<Parameters<typeof ImSearchDialog>[0], keyof ReturnType<typeof useAskAILauncher>["dialog"]> & {
  askPage?: () => AskAIPage | null;
  selection?: AskAISelection;
};

/** The page side: owns the open state and an Ask AI entry like the header badge. */
function Harness({ askPage, selection, ...props }: HarnessProps) {
  const launcher = useAskAILauncher(askPage);
  return (
    <>
      <button type="button" onClick={() => launcher.show(selection)}>
        entry
      </button>
      <ImSearchDialog {...launcher.dialog} {...props} />
    </>
  );
}

function renderDialog(props: HarnessProps = {}) {
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
      <Harness {...props} />
    </NavigationProvider>,
  );
  return navigation;
}

async function search(value: string) {
  const input = await screen.findByRole("combobox");
  fireEvent.change(input, { target: { value } });
  // Result rows stay disabled until the debounced keyword catches up.
  await waitFor(() =>
    expect(screen.getAllByRole("option").filter((o) => o.getAttribute("aria-disabled") !== "true").length).toBeGreaterThan(1),
  );
  expect(screen.getByRole("option", { name: /Ask AI/ })).toHaveAttribute("aria-selected", "true");
  return input;
}

describe("ImSearchDialog", () => {
  beforeEach(() => {
    configureShortcutPlatform("macos");
    docsErrorRef.current = false;
    askMutate.mockReset();
  });
  afterEach(() => configureShortcutPlatform(null));

  it("opens on Mod+O with recent chats and recently modified notes", async () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).toBeNull();

    pressOpen();
    expect(optionTexts(await screen.findByRole("group", { name: "Recent chats" }))[0]).toContain("Standup");
    expect(optionTexts(screen.getByRole("group", { name: "Recently modified notes" }))).toEqual(["readme", "planStrategy"]);
  });

  it("groups hits by kind on the All tab, each ranked, and opens the chosen chat", async () => {
    const navigation = renderDialog();
    pressOpen();
    const input = await search("roadmap");

    const headings = [...document.querySelectorAll("[cmdk-group-heading]")].map((h) => h.textContent);
    expect(headings).toEqual(["Chats", "Contacts", "Notes"]);
    // Title match beats more message hits.
    expect(optionTexts(screen.getByRole("group", { name: "Chats" })).map((t) => t?.slice(0, 7))).toEqual(["Roadmap", "Standup"]);
    expect(optionTexts(screen.getByRole("group", { name: "Contacts" }))[0]).toContain("Roadmapper");
    expect(optionTexts(screen.getByRole("group", { name: "Notes" }))[0]).toContain("Roadmap");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigation.push).toHaveBeenCalledWith("/acme/im?chat=c-new");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("searches one kind from its tab and hands the pick to the page", async () => {
    const onOpenContact = vi.fn();
    renderDialog({ onOpenContact });
    pressOpen();
    await search("roadmap");

    fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(screen.queryByRole("group", { name: "Chats" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onOpenContact).toHaveBeenCalledWith(agents[0]);
  });

  it("leaves out notes on the All tab when the knowledge base fails", async () => {
    docsErrorRef.current = true;
    renderDialog();
    pressOpen();
    await search("roadmap");

    expect(screen.queryByRole("group", { name: "Notes" })).toBeNull();
    expect(screen.getByRole("group", { name: "Chats" })).toBeInTheDocument();
  });

  it("offers Ask AI first and sends the question with the page it was asked from", async () => {
    const page = { contact: { type: "agent" as const, name: "Ops", description: "Runs deploys" } };
    const onOpenChat = vi.fn();
    renderDialog({ askPage: () => page, onOpenChat });
    pressOpen();
    expect(await screen.findByRole("option", { name: /Ask AI/ })).toHaveAttribute("aria-disabled", "true");

    expect(within(screen.getByRole("group", { name: "Sent with your question" })).getByText("Ops")).toBeInTheDocument();

    const input = await search("  who deploys?  ");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Ask AIwho deploys?");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(askMutate).toHaveBeenCalledWith({ query: "who deploys?", page, files: [] }, expect.anything());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => askMutate.mock.calls[0]![1].onSuccess({ chat: { id: "c-dm" } }));
    expect(onOpenChat).toHaveBeenCalledWith("c-dm");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("reads the page when it opens and lets the quoted context be dropped", async () => {
    let title = "Ops room";
    const askPage = () => ({ chat: { title, agents: [], messages: [{ time: "t", sender: "Ann", content: "hi" }] } });
    renderDialog({ askPage });
    pressOpen();
    const quote = await screen.findByRole("group", { name: "Sent with your question" });
    expect(quote).toHaveTextContent("Ops room · 1 message on screen");
    title = "Changed later";

    fireEvent.click(within(quote).getByRole("button", { name: "Don't send this context" }));
    expect(screen.queryByRole("group", { name: "Sent with your question" })).toBeNull();
    const input = await search("status?");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(askMutate).toHaveBeenCalledWith({ query: "status?", page: null, files: [] }, expect.anything());
  });

  it("carries a message picked from the chat alongside the page", async () => {
    const page = { chat: { title: "Ops room", agents: ["Deployer"], messages: [] } };
    const selection = { message_id: "m9", time: "t", sender: "Ann", content: "the deploy failed at step 3", text: "step 3" };
    renderDialog({ askPage: () => page, selection });
    fireEvent.click(screen.getByRole("button", { name: "entry" }));

    const quote = await screen.findByRole("group", { name: "Sent with your question" });
    expect(quote).toHaveTextContent("Ann: step 3");
    const input = await search("why?");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(askMutate).toHaveBeenCalledWith({ query: "why?", page: { ...page, selection }, files: [] }, expect.anything());
  });

  it("turns into a question once a file is attached, without searching", async () => {
    const { useQuery } = await import("@tanstack/react-query");
    renderDialog();
    pressOpen();
    const input = await screen.findByRole("combobox");
    const file = new File(["log"], "trace.log", { type: "text/plain" });
    fireEvent.paste(input, { clipboardData: { files: [file] } });

    expect(await screen.findByText("trace.log")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Contacts" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    const ask = screen.getByRole("option", { name: /Ask AI/ });
    expect(ask).toHaveTextContent("Ask AI1 file");
    expect(ask).toHaveAttribute("aria-selected", "true");

    vi.mocked(useQuery).mockClear();
    fireEvent.change(input, { target: { value: "what failed?" } });
    await new Promise((r) => setTimeout(r, 250));
    const searches = vi.mocked(useQuery).mock.calls.filter(([o]) => (o.queryKey as string[]).includes("what failed?"));
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every(([o]) => o.enabled === false)).toBe(true);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(askMutate).toHaveBeenCalledWith({ query: "what failed?", page: null, files: [file] }, expect.anything());
  });
});
