// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { DocNode } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { KnowledgeSidebar } from "./knowledge-sidebar";

const node = (path: string, children?: DocNode[]): DocNode => ({
  name: path.split("/").pop() ?? path,
  path,
  type: children ? "dir" : "file",
  child_count: children?.length ?? 0,
  modified_at: children ? null : "2026-01-02T08:00:00Z",
  children: children ?? [],
  match: "",
  snippet: "",
  hits: 0,
});

const tree = [
  node("Strategy", [node("Strategy/2025", [node("Strategy/2025/plan.md")]), node("Strategy/budget.md")]),
  node("readme.md"),
];
let searchNodes: DocNode[] = [];

vi.mock("@multica/core/docs", () => ({
  docsTreeOptions: () => ({ queryKey: ["docs", "tree"] }),
  docsSearchOptions: (q: string) => ({ queryKey: ["docs", "search", q] }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(({ queryKey }: { queryKey: string[] }) =>
      queryKey[1] === "tree"
        ? { data: tree, isPending: false, isError: false }
        : queryKey[2]
          ? { data: { query: queryKey[2], nodes: searchNodes, truncated: false }, isPending: false, isError: false }
          : { data: undefined, isPending: true, isError: false },
    ),
  };
});

describe("KnowledgeSidebar", () => {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  beforeEach(() => {
    onSelect.mockReset();
    onCreate.mockReset();
    searchNodes = [];
    // jsdom has no layout, so scrollIntoView isn't defined at all.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("opens top-level folders and toggles nested ones", () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: /^Strategy/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("budget.md")).toBeInTheDocument();
    expect(screen.queryByText("plan.md")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^2025/ }));
    fireEvent.click(screen.getByRole("button", { name: /^plan\.md/ }));
    expect(onSelect).toHaveBeenCalledWith("Strategy/2025/plan.md");
  });

  it("expands the folders of the open note and creates beside it", () => {
    renderWithI18n(<KnowledgeSidebar selectedPath="Strategy/2025/plan.md" onSelect={onSelect} onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: /^plan\.md/ })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(onCreate).toHaveBeenCalledWith("Strategy/2025");
  });

  it("re-expands, pins, and scrolls to the folders of a newly opened note", () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    const { rerender } = renderWithI18n(
      <KnowledgeSidebar selectedPath="Strategy/budget.md" onSelect={onSelect} onCreate={onCreate} />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Strategy/ }));
    expect(screen.queryByText("budget.md")).toBeNull();

    rerender(<KnowledgeSidebar selectedPath="Strategy/2025/plan.md" onSelect={onSelect} onCreate={onCreate} />);
    const leaf = screen.getByRole("button", { name: /^plan\.md/ });
    expect(leaf).toHaveAttribute("aria-current", "page");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    for (const [name, top] of [
      [/^Strategy/, "0px"],
      [/^2025/, "32px"],
    ] as const) {
      const pin = screen.getByRole("button", { name }).parentElement?.parentElement;
      expect(pin).toHaveClass("sticky");
      expect(pin).toHaveStyle({ top });
    }
  });

  it("shows server search hits fully expanded", async () => {
    searchNodes = [node("Deep", [node("Deep/Inner", [node("Deep/Inner/hit.md")])])];
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search notes" }), { target: { value: "hit" } });
    await waitFor(() => expect(screen.getByText("hit.md")).toBeInTheDocument());
    expect(screen.queryByText("readme.md")).toBeNull();
  });
});
