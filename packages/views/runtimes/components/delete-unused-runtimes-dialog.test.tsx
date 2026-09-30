// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AgentRuntime } from "@multica/core/types";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enRuntimes from "../../locales/en/runtimes.json";

const TEST_RESOURCES = { en: { common: enCommon, runtimes: enRuntimes } };

const { apiDeleteUnusedRuntimes, toastSuccess, toastInfo, toastError } =
  vi.hoisted(() => ({
    apiDeleteUnusedRuntimes: vi.fn(),
    toastSuccess: vi.fn(),
    toastInfo: vi.fn(),
    toastError: vi.fn(),
  }));

vi.mock("@multica/core/api", () => ({
  api: {
    deleteUnusedRuntimes: (...args: unknown[]) => apiDeleteUnusedRuntimes(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, info: toastInfo, error: toastError },
}));

import { DeleteUnusedRuntimesDialog } from "./delete-unused-runtimes-dialog";

function makeRuntime(id: string, name: string): AgentRuntime {
  return {
    id,
    workspace_id: "ws-1",
    daemon_id: "daemon-1",
    name,
    runtime_mode: "local",
    provider: "claude",
    launch_header: "",
    status: "offline",
    device_info: "",
    metadata: {},
    owner_id: "user-me",
    visibility: "private",
    last_seen_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function renderDialog(runtimes: AgentRuntime[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={qc}>
        <DeleteUnusedRuntimesDialog
          open
          onOpenChange={onOpenChange}
          runtimes={runtimes}
          wsId="ws-1"
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { onOpenChange };
}

describe("DeleteUnusedRuntimesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the runtimes and deletes exactly that set", async () => {
    apiDeleteUnusedRuntimes.mockResolvedValue({
      deleted_ids: ["rt-1", "rt-2"],
      skipped_ids: [],
    });
    const { onOpenChange } = renderDialog([
      makeRuntime("rt-1", "Old Claude"),
      makeRuntime("rt-2", "Old Codex"),
    ]);

    expect(screen.getByText("Delete 2 unused runtimes?")).toBeInTheDocument();
    expect(screen.getByText("Old Claude")).toBeInTheDocument();
    expect(screen.getByText("Old Codex")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete 2 runtimes" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(apiDeleteUnusedRuntimes).toHaveBeenCalledWith(["rt-1", "rt-2"]);
    expect(toastSuccess).toHaveBeenCalledWith("Deleted 2 runtimes");
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("reports runtimes the server kept because they are in use again", async () => {
    apiDeleteUnusedRuntimes.mockResolvedValue({
      deleted_ids: ["rt-1"],
      skipped_ids: ["rt-2"],
    });
    renderDialog([
      makeRuntime("rt-1", "Old Claude"),
      makeRuntime("rt-2", "Old Codex"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Delete 2 runtimes" }));

    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith("Kept 1 runtime that is in use again"),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Deleted 1 runtime");
  });

  it("stays open and shows the error when the request fails", async () => {
    apiDeleteUnusedRuntimes.mockRejectedValue(new Error("boom"));
    const { onOpenChange } = renderDialog([makeRuntime("rt-1", "Old Claude")]);

    fireEvent.click(screen.getByRole("button", { name: "Delete 1 runtime" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("boom"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
