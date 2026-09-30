// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { configureShortcutPlatform } from "@multica/core/shortcuts";
import type { DocNode } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { KnowledgeSearchDialog } from "./knowledge-search-dialog";

const node = (path: string, children?: DocNode[], modified_at: string | null = null): DocNode => ({
  name: path.split("/").pop() ?? path,
  path,
  type: children ? "dir" : "file",
  child_count: children?.length ?? 0,
  modified_at,
  children: children ?? [],
  match: "",
  snippet: "",
});

const tree = [
  node("Strategy", [node("Strategy/plan.md", undefined, "2026-01-01T00:00:00Z")]),
  node("readme.md", undefined, "2026-02-01T00:00:00Z"),
];
const searchNodes = [
  node("Deep", [node("Deep/Inner", [node("Deep/Inner/first.md")]), node("Deep/second.md")]),
];

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
        ? { data: tree, isError: false, isFetching: false, isPlaceholderData: false }
        : queryKey[2]
          ? {
              data: { query: queryKey[2], nodes: searchNodes, truncated: false },
              isError: false,
              isFetching: false,
              isPlaceholderData: false,
            }
          : { data: undefined, isError: false, isFetching: false, isPlaceholderData: false },
    ),
  };
});

const pressOpen = () => fireEvent.keyDown(document, { key: "o", metaKey: true });

describe("KnowledgeSearchDialog", () => {
  const onSelect = vi.fn();
  beforeEach(() => {
    configureShortcutPlatform("macos");
    onSelect.mockReset();
  });
  afterEach(() => configureShortcutPlatform(null));

  it("opens on Mod+O and lists recently modified notes flat", async () => {
    renderWithI18n(<KnowledgeSearchDialog onSelect={onSelect} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    pressOpen();
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["readme", "planStrategy"]);
  });

  it("moves through search hits with arrow keys and opens the chosen note on Enter", async () => {
    renderWithI18n(<KnowledgeSearchDialog onSelect={onSelect} />);
    pressOpen();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "deep" } });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByText("Inner")).toBeNull();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("Deep/second.md");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
