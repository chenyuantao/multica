// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Reminder } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { toDateKey } from "./reminder-dates";

const createMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "user-1" } };
  return {
    useAuthStore: (selector: (s: typeof state) => unknown) => selector(state),
  };
});
vi.mock("@multica/core/reminders", () => ({
  useCreateReminder: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));
vi.mock("./use-chat-directory", () => ({
  useChatDirectory: () => ({
    people: [
      { type: "member", id: "user-1", name: "Tao", detail: "" },
      { type: "member", id: "user-2", name: "Ada", detail: "" },
    ],
    agents: [{ type: "agent", id: "agent-1", name: "Mika", detail: "" }],
  }),
}));

import { NewTaskDialog } from "./new-task-dialog";

const created = { id: "task-1", title: "", description: "Book the room" } as Reminder;

function renderDialog(onCreated = vi.fn()) {
  const onOpenChange = vi.fn();
  renderWithI18n(<NewTaskDialog wsId="ws-1" open onOpenChange={onOpenChange} onCreated={onCreated} />);
  return { onCreated, onOpenChange };
}

function placeCaret(field: HTMLElement, at: number) {
  (field as HTMLTextAreaElement).setSelectionRange(at, at);
}

beforeEach(() => {
  createMutateAsync.mockReset();
  createMutateAsync.mockResolvedValue(created);
});

describe("NewTaskDialog", () => {
  it("creates today's task on Enter and inserts a line for the modifier chords", async () => {
    const { onCreated, onOpenChange } = renderDialog();
    const field = screen.getByRole("textbox", { name: "Task" });
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: "Book the room", selectionStart: 13 } });
    placeCaret(field, 13);
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(field).toHaveValue("Book the room\n");

    fireEvent.change(field, { target: { value: "Book the room\nwith Ada", selectionStart: 22 } });
    placeCaret(field, "Book the room\nwith Ada".length);
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect((field as HTMLTextAreaElement).value.startsWith("Book the room\nwith Ada\n")).toBe(true);

    fireEvent.change(field, { target: { value: "  Book the room " } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(createMutateAsync).toHaveBeenCalledWith({
      description: "Book the room",
      due_date: toDateKey(new Date()),
      task: true,
    });
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers people and agents after @", () => {
    renderDialog();
    const field = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(field, { target: { value: "@", selectionStart: 1 } });
    placeCaret(field, 1);
    fireEvent.click(field);
    expect(screen.getByRole("option", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mika" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Tao" })).not.toBeInTheDocument();
  });
});
