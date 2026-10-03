// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { docsKeys } from "@multica/core/docs";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { CHAT_DOCUMENT_ROW_PX, chatDocumentListMaxPx } from "./chat-documents";
import { ChatDocumentsSection } from "./chat-documents-section";
import { KnowledgeNotesProvider } from "./knowledge-note-tabs";

const useQueryMock = vi.hoisted(() => vi.fn(() => ({ data: [] as unknown[] })));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: useQueryMock };
});

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function fence(note: { name: string; summary: string; path: string }): string {
  return "```obsidian\n" + JSON.stringify(note) + "\n```";
}

function message(id: string, hours: number, note: { name: string; summary: string; path: string }) {
  return { id, type: "comment", created_at: hoursAgo(hours), deleted_at: null, content: fence(note) };
}

function chat(isDirect = false): GroupChat {
  return {
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
    unread_count: 0,
    is_direct: isDirect,
    pinned: false,
    members: [],
  };
}

function navigation(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/im",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
}

function renderSection(options?: { isDirect?: boolean; locale?: "en" | "zh-Hans"; onOpen?: (note: { path: string; name: string }) => void; client?: QueryClient }) {
  const adapter = navigation();
  const client = options?.client ?? new QueryClient();
  const view = renderWithI18n(
    <QueryClientProvider client={client}>
      <WorkspaceSlugProvider slug="acme">
        <NavigationProvider value={adapter}>
          <KnowledgeNotesProvider onOpen={options?.onOpen ?? vi.fn()}>
            <ChatDocumentsSection wsId="ws-1" chat={chat(options?.isDirect)} />
          </KnowledgeNotesProvider>
        </NavigationProvider>
      </WorkspaceSlugProvider>
    </QueryClientProvider>,
    { locale: options?.locale },
  );
  return { adapter, client, unmount: view.unmount };
}

describe("ChatDocumentsSection", () => {
  beforeEach(() => useQueryMock.mockReset().mockReturnValue({ data: [] }));

  it("lists each note once, newest first, with the card fields and the time it appeared", () => {
    useQueryMock.mockReturnValue({
      data: [
        message("old", 49, { name: "周报", summary: "第一版", path: "Work/周报.md" }),
        message("new", 10, { name: "计划", summary: "本周安排", path: "Work/计划.md" }),
        message("mid", 25, { name: "周报", summary: "已发布", path: "Work/周报.md" }),
      ],
    });
    renderSection();

    const items = screen.getAllByRole("link");
    expect(items.map((item) => item.querySelector(".font-medium")?.textContent)).toEqual(["计划", "周报"]);
    expect(items[1]).toHaveTextContent("已发布");
    expect(items[1]).toHaveTextContent("Work/周报.md");
    expect(items[0]?.querySelector("time")).toHaveTextContent("10h ago");
    expect(items[1]?.querySelector("time")?.getAttribute("dateTime")).toMatch(/^\d{4}-/);
    expect(screen.getByRole("heading", { name: "Documents in this group" })).toBeInTheDocument();
  });

  it("shows three rows and scrolls the rest inside the list", () => {
    useQueryMock.mockReturnValue({
      data: [
        message("a", 10, { name: "A", summary: "a", path: "Work/A.md" }),
        message("b", 25, { name: "B", summary: "b", path: "Work/B.md" }),
        message("c", 49, { name: "C", summary: "c", path: "Work/C.md" }),
        message("d", 73, { name: "D", summary: "d", path: "Work/D.md" }),
      ],
    });
    renderSection();

    const list = screen.getByRole("list", { name: "Documents in this group" });
    expect(list).toHaveStyle({ maxHeight: `${chatDocumentListMaxPx()}px` });
    expect(list.className).toContain("overflow-y-auto");
    const rows = screen.getAllByRole("link");
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.parentElement).toHaveStyle({ height: `${CHAT_DOCUMENT_ROW_PX}px` });
  });

  it("opens the note in the chat sidebar", async () => {
    useQueryMock.mockReturnValue({
      data: [message("m", 10, { name: "Weekly", summary: "Shipped", path: "Work/Weekly.md" })],
    });
    const open = vi.fn();
    const client = new QueryClient();
    client.setQueryData(docsKeys.file("Work/Weekly.md"), { content: "stale" });
    const { adapter } = renderSection({ onOpen: open, client });

    await userEvent.click(screen.getByRole("link", { name: /Weekly/ }));

    expect(open).toHaveBeenCalledWith({ path: "Work/Weekly.md", name: "Weekly" });
    expect(adapter.push).not.toHaveBeenCalled();
    expect(client.getQueryData(docsKeys.file("Work/Weekly.md"))).toBeUndefined();
  });

  it("stays quiet when the chat has no document cards", () => {
    renderSection({ isDirect: true });
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Documents in this chat" })).toBeNull();
  });

  it("names the section for a group and a direct chat", () => {
    useQueryMock.mockReturnValue({
      data: [message("m", 10, { name: "备忘", summary: "一条", path: "Notes/备忘.md" })],
    });
    const { unmount } = renderSection({ locale: "zh-Hans" });
    expect(screen.getByRole("heading", { name: "群聊中的文档" })).toBeInTheDocument();
    unmount();

    renderSection({ isDirect: true, locale: "zh-Hans" });
    expect(screen.getByRole("heading", { name: "单聊中的文档" })).toBeInTheDocument();
  });
});
