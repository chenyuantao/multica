// @vitest-environment jsdom

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { GroupChat } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatSidePanel } from "./chat-side-panel";

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: () => "Lambda" }),
}));

vi.mock("./chat-details-panel", () => ({
  ChatDetailsPanel: ({ chat }: { chat: { id: string } }) => {
    const [text, setText] = useState("");
    return (
      <div>
        group details
        <input aria-label={`details ${chat.id}`} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    );
  },
}));

vi.mock("./knowledge-document", () => ({
  KnowledgeDocument: ({ path }: { path: string }) => {
    const [text, setText] = useState("");
    return (
      <div>
        <span>{`doc ${path}`}</span>
        <input aria-label={`edit ${path}`} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    );
  },
}));

vi.mock("./document-voice-ask", () => ({
  DocumentVoiceAsk: ({ path, chatId }: { path: string; chatId: string }) => (
    <div>{`voice ${chatId} ${path}`}</div>
  ),
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

function box(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height: 10,
    top: 0,
    bottom: 10,
    left: 0,
    right: width,
    toJSON: () => ({}),
  };
}

/** Middle content is 680px and the panel is 320px, so the pair is 1000px. A leading list is wider and must not count. */
function mockContentPair() {
  const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.middle != null) return box(680);
    if (this.dataset.list != null) return box(900);
    if (this.querySelector("[role='separator']")) return box(320);
    return box(0);
  });
  return () => rects.mockRestore();
}

function renderPanel(notes: { path: string; name: string }[] = [], activePath: string | null = null) {
  const onSelectDetails = vi.fn();
  const onSelectNote = vi.fn();
  const onCloseNote = vi.fn();
  renderWithI18n(
    <>
      <div data-list="" />
      <div data-middle="" />
      <ChatSidePanel
        wsId="ws-1"
        chat={chat}
        userId="user-1"
        notes={notes}
        activePath={activePath}
        onSelectDetails={onSelectDetails}
        onSelectNote={onSelectNote}
        onCloseNote={onCloseNote}
      />
    </>,
  );
  return { onSelectDetails, onSelectNote, onCloseNote };
}

describe("ChatSidePanel", () => {
  afterEach(() => localStorage.clear());

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
    expect(screen.queryByText("voice c1 Work/周报.md")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Launch" }));
    expect(onSelectDetails).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "计划" }));
    expect(onSelectNote).toHaveBeenCalledWith(plan.path);
    fireEvent.click(screen.getByRole("button", { name: "Close 周报" }));
    expect(onCloseNote).toHaveBeenCalledWith(weekly.path);
    expect(screen.queryByRole("button", { name: "Close Launch" })).toBeNull();
  });

  it("caps the details column at 7:3 of the middle content, ignoring the list", () => {
    const restore = mockContentPair();
    renderPanel();
    const handle = screen.getByRole("separator", { name: "Resize panel" });
    expect(handle).toHaveAttribute("aria-valuemin", "300");
    expect(handle).toHaveAttribute("aria-valuemax", "700");
    expect(handle).toHaveAttribute("aria-valuenow", "320");
    restore();
  });

  it("widens to 7:3 of the middle content when a document opens", () => {
    const restore = mockContentPair();
    renderPanel([weekly], weekly.path);
    const handle = screen.getByRole("separator", { name: "Resize panel" });
    expect(handle).toHaveAttribute("aria-valuenow", "700");
    expect(handle.parentElement).toHaveStyle({ width: "700px" });
    expect(localStorage.getItem("multica:im-column-width:details")).toBe("700");
    restore();
  });

  it("keeps a manual width until another document opens", () => {
    const props = {
      wsId: "ws-1",
      chat,
      userId: "user-1",
      notes: [weekly, plan],
      onSelectDetails: vi.fn(),
      onSelectNote: vi.fn(),
      onCloseNote: vi.fn(),
    };
    const restore = mockContentPair();
    const view = renderWithI18n(
      <>
        <div data-list="" />
        <div data-middle="" />
        <ChatSidePanel {...props} activePath={weekly.path} />
      </>,
    );
    const handle = () => screen.getByRole("separator", { name: "Resize panel" });
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle()).toHaveAttribute("aria-valuenow", "684");

    view.rerender(
      <>
        <div data-list="" />
        <div data-middle="" />
        <ChatSidePanel {...props} activePath={weekly.path} />
      </>,
    );
    expect(handle()).toHaveAttribute("aria-valuenow", "684");

    view.rerender(
      <>
        <div data-list="" />
        <div data-middle="" />
        <ChatSidePanel {...props} activePath={plan.path} />
      </>,
    );
    expect(handle()).toHaveAttribute("aria-valuenow", "700");
    restore();
  });

  it("keeps the previous tab's text when another tab is selected", () => {
    const props = {
      wsId: "ws-1",
      chat,
      userId: "user-1",
      notes: [weekly, plan],
      onSelectDetails: vi.fn(),
      onSelectNote: vi.fn(),
      onCloseNote: vi.fn(),
    };
    const view = renderWithI18n(<ChatSidePanel {...props} activePath={null} />);
    fireEvent.change(screen.getByRole("textbox", { name: "details c1" }), { target: { value: "群公告" } });

    view.rerender(<ChatSidePanel {...props} activePath={weekly.path} />);
    fireEvent.change(screen.getByRole("textbox", { name: "edit Work/周报.md" }), { target: { value: "还在写" } });
    expect(screen.getByRole("textbox", { name: "details c1", hidden: true })).toHaveValue("群公告");

    view.rerender(<ChatSidePanel {...props} activePath={plan.path} />);
    expect(screen.getByRole("textbox", { name: "edit Work/计划.md" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "edit Work/周报.md", hidden: true })).toHaveValue("还在写");
    expect(screen.getByRole("textbox", { name: "edit Work/周报.md", hidden: true })).not.toBeVisible();

    view.rerender(<ChatSidePanel {...props} activePath={weekly.path} />);
    expect(screen.getByRole("textbox", { name: "edit Work/周报.md" })).toHaveValue("还在写");

    const standup = { ...chat, id: "c2", title: "Standup" } as GroupChat;
    view.rerender(<ChatSidePanel {...props} chat={standup} notes={[]} activePath={null} />);
    expect(screen.queryByRole("textbox", { name: "edit Work/周报.md", hidden: true })).not.toBeNull();

    view.rerender(<ChatSidePanel {...props} notes={[weekly]} activePath={weekly.path} />);
    expect(screen.getByRole("textbox", { name: "edit Work/周报.md" })).toHaveValue("还在写");

    view.rerender(<ChatSidePanel {...props} notes={[]} activePath={null} />);
    expect(screen.queryByRole("textbox", { name: "edit Work/周报.md", hidden: true })).toBeNull();
  });

  it("leaves the stored width alone when a document opens full screen", () => {
    renderWithI18n(
      <ChatSidePanel
        wsId="ws-1"
        chat={chat}
        userId="user-1"
        notes={[weekly]}
        activePath={weekly.path}
        onSelectDetails={vi.fn()}
        onSelectNote={vi.fn()}
        onCloseNote={vi.fn()}
        chrome="page"
      />,
    );
    expect(localStorage.getItem("multica:im-column-width:details")).toBeNull();
    expect(screen.getByText("voice c1 Work/周报.md")).toBeInTheDocument();
  });
});
