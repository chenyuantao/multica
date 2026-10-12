// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { DocNode } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
vi.mock("./im-sidebar-search", () => ({
  ImSidebarSearch: () => <input aria-label="Search" />,
}));

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

// Every top-level node is a machine that shares a folder.
const mbp = node("mbp", [
  node("mbp/Strategy", [node("mbp/Strategy/2025", [node("mbp/Strategy/2025/plan.md")]), node("mbp/Strategy/budget.md")]),
  node("mbp/readme.md"),
]);
let tree: DocNode[] = [mbp];
let searchNodes: DocNode[] = [];

const { moveDoc, createFolder, renameDoc, deleteDoc } = vi.hoisted(() => ({
  moveDoc: vi.fn(),
  createFolder: vi.fn(),
  renameDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock("@multica/core/docs", () => ({
  docsTreeOptions: () => ({ queryKey: ["docs", "tree"] }),
  docsSearchOptions: (q: string) => ({ queryKey: ["docs", "search", q] }),
  useMoveDoc: () => ({ mutateAsync: moveDoc }),
  useCreateDocFolder: () => ({ mutateAsync: createFolder, isPending: false }),
  useRenameDoc: () => ({ mutateAsync: renameDoc, isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: deleteDoc, isPending: false }),
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
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    onSelect.mockReset();
    onCreate.mockReset();
    moveDoc.mockReset();
    moveDoc.mockResolvedValue({ from: "mbp/readme.md", path: "mbp/Strategy/readme.md", name: "readme.md", type: "file" });
    createFolder.mockReset();
    createFolder.mockResolvedValue({ path: "mbp/Strategy/Archive", name: "Archive", type: "dir" });
    renameDoc.mockReset();
    renameDoc.mockResolvedValue({ from: "mbp/readme.md", path: "mbp/hello.md", name: "hello.md", type: "file" });
    deleteDoc.mockReset();
    deleteDoc.mockResolvedValue({ path: "mbp/readme.md" });
    tree = [mbp];
    searchNodes = [];
    // jsdom has no layout, so scrollIntoView isn't defined at all.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("opens machine roots and toggles the folders inside them", () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: /^mbp/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Strategy/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("budget.md")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Strategy/ }));
    fireEvent.click(screen.getByRole("button", { name: /^2025/ }));
    fireEvent.click(screen.getByRole("button", { name: /^plan\.md/ }));
    expect(onSelect).toHaveBeenCalledWith("mbp/Strategy/2025/plan.md");
  });

  it("expands the folders of the open note and creates beside it", () => {
    renderWithI18n(<KnowledgeSidebar selectedPath="mbp/Strategy/2025/plan.md" onSelect={onSelect} onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: /^plan\.md/ })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(onCreate).toHaveBeenCalledWith("mbp/Strategy/2025");
  });

  it("creates in the only machine, and needs an open note to pick between several", () => {
    const { unmount } = renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(onCreate).toHaveBeenCalledWith("mbp");
    unmount();

    tree = [mbp, node("studio", [node("studio/a.md")])];
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: "New note" })).toBeDisabled();
  });

  it("says how to share a folder when nothing is shared", () => {
    tree = [];
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    expect(screen.getByText(/multica-file share/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New note" })).toBeDisabled();
  });

  it("re-expands, pins, and scrolls to the folders of a newly opened note", () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    const { rerender } = renderWithI18n(
      <KnowledgeSidebar selectedPath="mbp/Strategy/budget.md" onSelect={onSelect} onCreate={onCreate} />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Strategy/ }));
    expect(screen.queryByText("budget.md")).toBeNull();

    rerender(<KnowledgeSidebar selectedPath="mbp/Strategy/2025/plan.md" onSelect={onSelect} onCreate={onCreate} />);
    const leaf = screen.getByRole("button", { name: /^plan\.md/ });
    expect(leaf).toHaveAttribute("aria-current", "page");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    for (const [name, top] of [
      [/^mbp/, "0px"],
      [/^Strategy/, "32px"],
      [/^2025/, "64px"],
    ] as const) {
      const pin = screen.getByRole("button", { name }).parentElement?.parentElement;
      expect(pin).toHaveClass("sticky");
      expect(pin).toHaveStyle({ top });
    }
  });

  function row(name: RegExp) {
    const button = screen.getByRole("button", { name });
    const el = button.parentElement;
    if (!el) throw new Error(`row missing for ${name}`);
    return el;
  }

  function dragTransfer(): DataTransfer {
    const data = new Map<string, string>();
    return {
      dropEffect: "none",
      effectAllowed: "all",
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      types: ["text/plain"],
      setData: (format: string, value: string) => {
        data.set(format, value);
      },
      getData: (format: string) => data.get(format) ?? "",
      clearData: () => data.clear(),
      setDragImage: () => {},
    } as DataTransfer;
  }

  it("moves a note into the folder it is dropped on", () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    const transfer = dragTransfer();
    fireEvent.dragStart(row(/^readme\.md/), { dataTransfer: transfer });
    fireEvent.dragOver(row(/^Strategy/), { dataTransfer: transfer });
    fireEvent.drop(row(/^Strategy/), { dataTransfer: transfer });
    expect(moveDoc).toHaveBeenCalledWith({ path: "mbp/readme.md", dest: "mbp/Strategy" });
  });

  it("does not move a note to another machine", () => {
    tree = [mbp, node("studio", [node("studio/Inbox", [node("studio/Inbox/a.md")])])];
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    const transfer = dragTransfer();
    fireEvent.dragStart(row(/^readme\.md/), { dataTransfer: transfer });
    fireEvent.dragOver(row(/^Inbox/), { dataTransfer: transfer });
    fireEvent.drop(row(/^Inbox/), { dataTransfer: transfer });
    expect(moveDoc).not.toHaveBeenCalled();
  });

  it("expands a collapsed folder after the pointer rests on it for 200ms", () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: /^Strategy/ }));
    const folder = screen.getByRole("button", { name: /^2025/ });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("plan.md")).toBeNull();

    vi.useFakeTimers();
    try {
      const transfer = dragTransfer();
      fireEvent.dragStart(row(/^readme\.md/), { dataTransfer: transfer });
      fireEvent.dragOver(row(/^2025/), { dataTransfer: transfer });
      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(folder).toHaveAttribute("aria-expanded", "false");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(folder).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("plan.md")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a folder from the right-click menu", async () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    fireEvent.contextMenu(screen.getByText("Strategy"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New folder here" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Archive" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ path: "mbp/Strategy/Archive" }));
  });

  it("renames a note from the right-click menu", async () => {
    const onRenamed = vi.fn();
    renderWithI18n(
      <KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} onRenamed={onRenamed} />,
    );
    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Name");
    expect(input).toHaveValue("readme");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(renameDoc).toHaveBeenCalledWith({ path: "mbp/readme.md", name: "hello.md" }));
    expect(onRenamed).toHaveBeenCalledWith({
      from: "mbp/readme.md",
      path: "mbp/hello.md",
      name: "hello.md",
      type: "file",
    });
  });

  it("asks before deleting a note, and only deletes after confirmation", async () => {
    const onDeleted = vi.fn();
    renderWithI18n(
      <KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} onDeleted={onDeleted} />,
    );
    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete note" }));
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("This note will be removed from the shared folder.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.contextMenu(screen.getByText("readme.md"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete note" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDoc).toHaveBeenCalledWith({ path: "mbp/readme.md" }));
    expect(onDeleted).toHaveBeenCalledWith("mbp/readme.md");
  });

  it("asks before deleting a folder and its contents", async () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    fireEvent.contextMenu(screen.getByText("Strategy"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete folder" }));
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("This folder and everything in it will be removed.");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDoc).toHaveBeenCalledWith({ path: "mbp/Strategy" }));
  });

  it("does not offer rename or delete on a machine share", async () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /^mbp/ }));
    expect(await screen.findByRole("menuitem", { name: "New folder here" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete folder" })).toBeNull();
  });

  it("does not expand a folder when the pointer rests on a note", () => {
    renderWithI18n(<KnowledgeSidebar selectedPath={null} onSelect={onSelect} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: /^Strategy/ }));
    vi.useFakeTimers();
    try {
      const transfer = dragTransfer();
      fireEvent.dragStart(row(/^readme\.md/), { dataTransfer: transfer });
      fireEvent.dragOver(row(/^budget\.md/), { dataTransfer: transfer });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByRole("button", { name: /^2025/ })).toHaveAttribute("aria-expanded", "false");
    } finally {
      vi.useRealTimers();
    }
  });
});
