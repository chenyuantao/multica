import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { docsKeys } from "@multica/core/docs";
import { renderWithI18n } from "../test/i18n";

vi.mock("../im/knowledge-document", () => ({
  KnowledgeDocument: ({ path }: { path: string }) => <div data-testid="knowledge-document">{path}</div>,
}));

vi.mock("../editor/link-hover-card", () => ({
  useLinkHover: () => ({}),
  LinkHoverCard: () => null,
}));

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));

import { RichContent } from "./rich-content";

function renderContent(content: string, qc = new QueryClient()) {
  return renderWithI18n(
    <QueryClientProvider client={qc}>
      <RichContent content={content} />
    </QueryClientProvider>,
  );
}

const fence = (body: string) => `Done.\n\n\`\`\`obsidian\n${body}\n\`\`\`\n`;

describe("obsidian note fence", () => {
  it("renders a note card that opens the note in a dialog with fresh content", async () => {
    const qc = new QueryClient();
    qc.setQueryData(docsKeys.file("Work/周报.md"), { path: "Work/周报.md", content: "stale" });
    renderContent(fence('{"name":"周报","summary":"本周完成了发布","path":"Work/周报.md"}'), qc);

    const card = screen.getByRole("button", { name: /周报/ });
    expect(card).toHaveTextContent("本周完成了发布");
    expect(card).toHaveTextContent("Work/周报.md");

    await userEvent.click(card);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("周报");
    expect(await screen.findByTestId("knowledge-document")).toHaveTextContent("Work/周报.md");
    await waitFor(() => expect(qc.getQueryData(docsKeys.file("Work/周报.md"))).toBeUndefined());
  });

  it("keeps an unusable body as source", () => {
    renderContent(fence('{"name":"x","path":"/Users/me/vault/x.md"}'));
    expect(screen.queryByRole("button", { name: /^x/ })).toBeNull();
    expect(screen.getByText(/\/Users\/me\/vault\/x\.md/)).toBeInTheDocument();
  });
});
