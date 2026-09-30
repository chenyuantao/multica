// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatSidebar } from "./chat-sidebar";

const appForeground = vi.hoisted(() => ({ value: true }));

vi.mock("../common/use-app-foreground", () => ({ useAppForeground: () => appForeground.value }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => `name-${id}` }),
}));

function chat(id: string, unread: number): GroupChat {
  return {
    id,
    workspace_id: "ws-1",
    identifier: id,
    title: `Room ${id}`,
    description: "",
    creator_type: "member",
    creator_id: "user-1",
    created_at: "2026-09-28T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [],
    pending_speakers: [],
    unread_count: unread,
    is_direct: false,
  };
}

function renderSidebar(selectedId: string | null) {
  renderWithI18n(
    <ChatSidebar
      chats={[chat("a", 3), chat("b", 2), chat("c", 0)]}
      isLoading={false}
      isError={false}
      selectedId={selectedId}
      userId="user-1"
      onSelect={() => {}}
      onNewChat={() => {}}
    />,
  );
}

describe("ChatSidebar unread badges", () => {
  beforeEach(() => {
    appForeground.value = true;
  });

  it("badges each chat with its unread messages and skips the open one", () => {
    renderSidebar("b");
    expect(screen.getByLabelText("3 unread messages")).toHaveTextContent("3");
    expect(screen.queryByLabelText("2 unread messages")).toBeNull();
  });

  it("keeps the open chat's badge while the app is in the background", () => {
    appForeground.value = false;
    renderSidebar("b");
    expect(screen.getByLabelText("2 unread messages")).toHaveTextContent("2");
  });
});
