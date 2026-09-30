// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { NavigationProvider, type NavigationAdapter } from "../navigation";

const mockModalOpen = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/modals", () => ({
  useModalStore: Object.assign(vi.fn(), {
    getState: () => ({ open: mockModalOpen }),
  }),
}));
vi.mock("../agents/components/agent-detail-page", () => ({
  AgentDetail: ({ agentId, presentation }: { agentId: string; presentation: string }) => (
    <div data-testid="agent-detail">
      {agentId}:{presentation}
    </div>
  ),
}));

import { AgentDetailModal, useOpenAgentDetail } from "./agent-detail";

function makeNavigation(pathname: string): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname,
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
}

function renderModal(pathname: string, data: Record<string, unknown> | null, onClose = vi.fn()) {
  const ui = (path: string) => (
    <NavigationProvider value={makeNavigation(path)}>
      <AgentDetailModal onClose={onClose} data={data} />
    </NavigationProvider>
  );
  const result = render(ui(pathname));
  return { ...result, onClose, rerenderAt: (path: string) => result.rerender(ui(path)) };
}

beforeEach(() => {
  mockModalOpen.mockReset();
});

describe("AgentDetailModal", () => {
  it("renders the agent detail in its modal presentation", () => {
    renderModal("/acme/im", { agentId: "agent-1", hostPathname: "/acme/im" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("agent-detail")).toHaveTextContent("agent-1:modal");
  });

  it("stays open while only the host route's query changes", () => {
    const { onClose, rerenderAt } = renderModal("/acme/im", { agentId: "agent-1", hostPathname: "/acme/im" });
    rerenderAt("/acme/im");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes once navigation leaves the host route", () => {
    const { onClose, rerenderAt } = renderModal("/acme/im", { agentId: "agent-1", hostPathname: "/acme/im" });
    rerenderAt("/acme/chat");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when it mounts on a route other than the one that opened it", () => {
    const { onClose } = renderModal("/acme/chat", { agentId: "agent-1", hostPathname: "/acme/im" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes without an agent id", () => {
    const { onClose } = renderModal("/acme/im", null);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("useOpenAgentDetail", () => {
  it("opens the modal with the current route as its host, leaving the URL alone", () => {
    const navigation = makeNavigation("/acme/member");
    const { result } = renderHook(() => useOpenAgentDetail(), {
      wrapper: ({ children }) => <NavigationProvider value={navigation}>{children}</NavigationProvider>,
    });
    result.current("agent-1");
    expect(mockModalOpen).toHaveBeenCalledWith("agent-detail", { agentId: "agent-1", hostPathname: "/acme/member" });
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
