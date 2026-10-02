// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { AgentTask } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { ChatProgressRoute } from "./chat-progress-view";

const tasksRef = vi.hoisted(() => ({ current: undefined as AgentTask[] | undefined, isPending: true }));
const cancel = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => ({ data: tasksRef.current, isPending: tasksRef.isPending }),
  };
});
vi.mock("@multica/core/chat/queries", () => ({ useTaskMessages: () => ({ data: [] }) }));
vi.mock("@multica/core/issues/mutations", () => ({ useCancelIssueRun: () => cancel }));
vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => `name-${id}` }),
}));
vi.mock("@multica/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/paths")>();
  return { ...actual, useWorkspacePaths: () => actual.paths.workspace("acme") };
});
vi.mock("../common/task-transcript/agent-transcript-dialog", () => ({
  AgentTranscriptDialog: ({
    presentation,
    agentName,
    onStop,
    isLive,
  }: {
    presentation?: string;
    agentName: string;
    onStop?: () => void;
    isLive?: boolean;
  }) => (
    <div data-presentation={presentation} data-live={isLive ? "yes" : "no"}>
      {agentName}
      {onStop && (
        <button type="button" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  ),
}));

function task(status: AgentTask["status"]): AgentTask {
  return {
    id: "task-1",
    agent_id: "agent-1",
    issue_id: "c1",
    runtime_id: "",
    status,
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "",
    kind: "comment",
  };
}

function renderRoute(taskId: string) {
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
      <ChatProgressRoute chatId="c1" taskId={taskId} />
    </NavigationProvider>,
  );
  return navigation;
}

beforeEach(() => {
  tasksRef.current = undefined;
  tasksRef.isPending = true;
  cancel.mutate.mockReset();
  cancel.isPending = false;
  cancel.isSuccess = false;
});

describe("ChatProgressRoute", () => {
  it("shows the transcript as a page with a way back to the chat", () => {
    tasksRef.current = [task("running")];
    tasksRef.isPending = false;
    const navigation = renderRoute("task-1");

    expect(screen.getByRole("heading", { name: "View progress" })).toBeInTheDocument();
    expect(screen.getByText("name-agent-1").closest("[data-presentation]")).toHaveAttribute("data-presentation", "page");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(navigation.replace).toHaveBeenCalledWith("/acme/im?chat=c1");
  });

  it("stops a live run from the page", () => {
    tasksRef.current = [task("running")];
    tasksRef.isPending = false;
    renderRoute("task-1");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(cancel.mutate).toHaveBeenCalledWith("task-1", expect.anything());
  });

  it("drops stop once the run has finished", () => {
    tasksRef.current = [task("completed")];
    tasksRef.isPending = false;
    renderRoute("task-1");
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByText("name-agent-1").closest("[data-live]")).toHaveAttribute("data-live", "no");
  });

  it("says the run is missing when the page has no task", () => {
    renderRoute("");
    expect(screen.getByText("This chat isn't available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });
});
