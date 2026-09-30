// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { DocFile } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { KnowledgeDocument } from "./knowledge-document";

const saveMutateAsync = vi.fn();
const file: DocFile = {
  path: "Strategy/plan.md",
  name: "plan.md",
  content: "---\ntags: [q3]\n---\n\n# Plan\n",
  modified_at: "2026-01-02T08:00:00Z",
  revision: "r1",
};

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: file, isPending: false, isError: false, error: null, refetch: vi.fn() })),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@multica/core/docs", () => ({
  docFileOptions: (path: string) => ({ queryKey: ["docs", "file", path] }),
  docsKeys: { file: (path: string) => ["docs", "file", path] },
  useSaveDocFile: () => ({ mutateAsync: saveMutateAsync }),
}));

vi.mock("../editor", () => ({
  ContentEditor: ({ defaultValue, onUpdate }: { defaultValue: string; onUpdate: (md: string) => void }) => (
    <textarea aria-label="body" defaultValue={defaultValue} onChange={(e) => onUpdate(e.target.value)} />
  ),
}));

describe("KnowledgeDocument", () => {
  beforeEach(() => saveMutateAsync.mockReset());

  it("edits only the body and saves each change on the latest revision", async () => {
    saveMutateAsync
      .mockResolvedValueOnce({ ...file, content: "---\ntags: [q3]\n---\n\n# Plan v2\n", revision: "r2" })
      .mockResolvedValueOnce({ ...file, content: "---\ntags: [q3]\n---\n\n# Plan v3\n", revision: "r3" });
    renderWithI18n(<KnowledgeDocument path={file.path} />);

    const body = screen.getByRole("textbox", { name: "body" });
    expect(body).toHaveValue("# Plan\n");
    expect(screen.getByRole("heading", { name: "plan" })).toBeInTheDocument();

    fireEvent.change(body, { target: { value: "# Plan v2" } });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(saveMutateAsync).toHaveBeenLastCalledWith({
      path: "Strategy/plan.md",
      content: "---\ntags: [q3]\n---\n\n# Plan v2\n",
      base_revision: "r1",
      base_content: file.content,
    });

    fireEvent.change(body, { target: { value: "# Plan v3" } });
    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalledTimes(2));
    expect(saveMutateAsync.mock.calls[1]?.[0]).toMatchObject({ base_revision: "r2" });
  });

  it("offers retry after a failed save", async () => {
    saveMutateAsync.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...file, revision: "r2" });
    renderWithI18n(<KnowledgeDocument path={file.path} />);

    fireEvent.change(screen.getByRole("textbox", { name: "body" }), { target: { value: "# Changed" } });
    const retry = await screen.findByRole("button", { name: /Couldn't save/ });
    fireEvent.click(retry);
    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalledTimes(2));
    expect(saveMutateAsync.mock.calls[1]?.[0]).toMatchObject({ content: "---\ntags: [q3]\n---\n\n# Changed\n" });
  });
});
