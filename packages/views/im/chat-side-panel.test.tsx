// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatSidePanel } from "./chat-side-panel";

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: () => "Lambda" }),
}));

vi.mock("./chat-details-panel", () => ({
  ChatDetailsPanel: () => <div>group details</div>,
}));

vi.mock("./knowledge-document", () => ({
  KnowledgeDocument: ({ path }: { path: string }) => <div>{`doc ${path}`}</div>,
}));

const chat = {
  id: "c1",
  title: "Launch",
  members: [
    { member_type: "member", member_id: "user-1" },
    { member_type: "agent", member_id: "agent-1" },
  ],
} as GroupChat;

const weekly = { path: "Work/周报.md", name: "周报" };
const plan = { path: "Work/计划.md", name: "计划" };

function renderPanel(notes: { path: string; name: string }[] = [], activePath: string | null = null) {
  const onSelectDetails = vi.fn();
  const onSelectNote = vi.fn();
  const onCloseNote = vi.fn();
  renderWithI18n(
    <ChatSidePanel
      wsId="ws-1"
      chat={chat}
      userId="user-1"
      notes={notes}
      activePath={activePath}
      onSelectDetails={onSelectDetails}
      onSelectNote={onSelectNote}
      onCloseNote={onCloseNote}
    />,
  );
  return { onSelectDetails, onSelectNote, onCloseNote };
}

describe("ChatSidePanel", () => {
  it("hides the tab bar while only the details are open", () => {
    renderPanel();
    expect(screen.getByText("group details")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("scrolls note tabs beside the details tab and closes one", async () => {
    const { onSelectNote, onCloseNote, onSelectDetails } = renderPanel([weekly, plan], weekly.path);
    const tabs = screen.getByRole("tablist", { name: "Chat details and notes" });
    expect(tabs.className).toContain("overflow-x-auto");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Launch", "周报", "计划"]);
    expect(screen.getByRole("tab", { name: "周报" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("doc Work/周报.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Launch" }));
    expect(onSelectDetails).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "计划" }));
    expect(onSelectNote).toHaveBeenCalledWith(plan.path);
    fireEvent.click(screen.getByRole("button", { name: "Close 周报" }));
    expect(onCloseNote).toHaveBeenCalledWith(weekly.path);
    expect(screen.queryByRole("button", { name: "Close Launch" })).toBeNull();
  });
});
