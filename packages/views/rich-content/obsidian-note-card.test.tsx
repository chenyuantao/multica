// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { docsKeys } from "@multica/core/docs";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { renderWithI18n } from "../test/i18n";
import { KnowledgeNotesProvider } from "../im/knowledge-note-tabs";
import { NavigationProvider, type NavigationAdapter } from "../navigation";

vi.mock("../editor/link-hover-card", () => ({
  useLinkHover: () => ({}),
  LinkHoverCard: () => null,
}));

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));

import { RichContent } from "./rich-content";

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

function renderContent(content: string, qc = new QueryClient(), onOpen?: (note: { path: string; name: string }) => void) {
  if (qc.getQueryData(docsKeys.tree()) === undefined) qc.setQueryData(docsKeys.tree(), []);
  const adapter = navigation();
  const view = (
    <QueryClientProvider client={qc}>
      <WorkspaceSlugProvider slug="acme">
        <NavigationProvider value={adapter}>
          <RichContent content={content} />
        </NavigationProvider>
      </WorkspaceSlugProvider>
    </QueryClientProvider>
  );
  renderWithI18n(onOpen ? <KnowledgeNotesProvider onOpen={onOpen}>{view}</KnowledgeNotesProvider> : view);
  return adapter;
}

const fence = (body: string) => `Done.\n\n\`\`\`docs\n${body}\n\`\`\`\n`;
const note = '{"name":"周报","summary":"本周完成了发布","path":"Work/周报.md"}';

describe("docs note fence", () => {
  it("renders a content-sized card that links to the knowledge note", async () => {
    const adapter = renderContent(fence(note));
    const card = screen.getByRole("link", { name: /周报/ });
    expect(card).toHaveTextContent("本周完成了发布");
    expect(card).toHaveTextContent("Work/周报.md");
    expect(card.className).toContain("w-full");
    expect(card.className).toContain("max-w-sm");
    expect(card.className).not.toMatch(/\bh-\[/);
    expect(card.className).not.toContain("w-[256px]");
    expect(card.querySelector(".line-clamp-2")).toHaveTextContent("周报");
    expect(card.querySelector(".line-clamp-3")).toHaveTextContent("本周完成了发布");
    expect(card.querySelector(".truncate")).toHaveTextContent("Work/周报.md");
    expect(card).toHaveAttribute("href", "/acme/knowledge?file=Work%2F%E5%91%A8%E6%8A%A5.md");
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(card);
    await waitFor(() => expect(adapter.push).toHaveBeenCalledWith("/acme/knowledge?file=Work%2F%E5%91%A8%E6%8A%A5.md"));
  });

  it("opens the docs path whose root the card left off", async () => {
    const qc = new QueryClient();
    qc.setQueryData(docsKeys.tree(), [
      {
        name: "mbp",
        path: "mbp",
        type: "dir",
        child_count: 1,
        modified_at: null,
        children: [
          {
            name: "周报.md",
            path: "mbp/Work/周报.md",
            type: "file",
            child_count: 0,
            modified_at: "2026-04-01T00:00:00Z",
            children: [],
            match: "",
            snippet: "",
            hits: 0,
          },
        ],
        match: "",
        snippet: "",
        hits: 0,
      },
    ]);
    const adapter = renderContent(fence(note), qc);
    const card = screen.getByRole("link", { name: /周报/ });
    expect(card).toHaveAttribute("href", "/acme/knowledge?file=mbp%2FWork%2F%E5%91%A8%E6%8A%A5.md");
    await userEvent.click(card);
    await waitFor(() =>
      expect(adapter.push).toHaveBeenCalledWith("/acme/knowledge?file=mbp%2FWork%2F%E5%91%A8%E6%8A%A5.md"),
    );
  });

  it("opens the doc in the chat sidebar instead of navigating", async () => {
    const qc = new QueryClient();
    qc.setQueryData(docsKeys.file("Work/周报.md"), { path: "Work/周报.md", content: "stale" });
    const open = vi.fn();
    const adapter = renderContent(fence(note), qc, open);

    await userEvent.click(screen.getByRole("link", { name: /周报/ }));

    await waitFor(() => expect(open).toHaveBeenCalledWith({ path: "Work/周报.md", name: "周报" }));
    expect(adapter.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(qc.getQueryData(docsKeys.file("Work/周报.md"))).toBeUndefined());
  });

  it("keeps an unusable body as source", () => {
    renderContent(fence('{"name":"x","path":"/Users/me/vault/x.md"}'));
    expect(screen.queryByRole("link", { name: /^x/ })).toBeNull();
    expect(screen.getByText(/\/Users\/me\/vault\/x\.md/)).toBeInTheDocument();
  });
});
