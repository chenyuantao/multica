// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Reminder } from "@multica/core/types";
import { visibleChats, type ChatListFilterState } from "./chat-list-filter";
import { fromDateKey } from "./reminder-dates";

const TODAY = "2026-10-12";

function reminder(id: string, due: string | null, extra: Partial<Reminder> = {}): Reminder {
  return {
    id,
    workspace_id: "ws-1",
    identifier: id,
    title: id,
    description: "",
    creator_type: "member",
    creator_id: "user-1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [],
    pending_speakers: [],
    unread_count: 0,
    is_direct: false,
    pinned: false,
    task: true,
    status: "todo",
    due_date: due,
    position: 1,
    pending: false,
    ...extra,
  };
}

function state(extra: Partial<ChatListFilterState> = {}): ChatListFilterState {
  return {
    scope: "all",
    view: null,
    anchor: fromDateKey(TODAY),
    todayKey: TODAY,
    tags: new Set(),
    hideCompleted: false,
    ...extra,
  };
}

const chats = [
  { id: "room", task: false },
  { id: "today", task: true },
  { id: "later", task: true },
  { id: "done", task: true },
  { id: "pinned", task: true },
];

const reminders = [
  reminder("today", TODAY),
  reminder("later", "2026-10-20"),
  reminder("done", TODAY, { status: "done" }),
  reminder("pinned", "2026-10-01", { pending: true, title: "Hold #docs" }),
];

describe("visibleChats", () => {
  it("keeps every chat until a filter is chosen", () => {
    expect(visibleChats(chats, reminders, state(), true).map((chat) => chat.id)).toEqual([
      "room",
      "today",
      "later",
      "done",
      "pinned",
    ]);
  });

  it("keeps only to-dos or only other chats", () => {
    expect(visibleChats(chats, reminders, state({ scope: "todo" }), true).map((chat) => chat.id)).toEqual([
      "today",
      "later",
      "done",
      "pinned",
    ]);
    expect(visibleChats(chats, reminders, state({ scope: "other" }), true).map((chat) => chat.id)).toEqual(["room"]);
  });

  it("filters to-dos the way Today does, and leaves other chats in place", () => {
    expect(visibleChats(chats, reminders, state({ view: "today" }), true).map((chat) => chat.id)).toEqual([
      "room",
      "today",
      "done",
      "pinned",
    ]);
  });

  it("hides completed to-dos on Today when that switch is on", () => {
    expect(
      visibleChats(chats, reminders, state({ view: "today", hideCompleted: true }), true).map((chat) => chat.id),
    ).toEqual(["room", "today", "pinned"]);
  });

  it("keeps a to-do whose week contains the anchor", () => {
    expect(visibleChats(chats, reminders, state({ view: "week", scope: "todo" }), true).map((chat) => chat.id)).toEqual([
      "today",
      "done",
      "pinned",
    ]);
  });

  it("matches an open to-do by tag and drops the rest", () => {
    expect(
      visibleChats(chats, reminders, state({ view: "open", tags: new Set(["docs"]), scope: "todo" }), true).map(
        (chat) => chat.id,
      ),
    ).toEqual(["pinned"]);
  });

  it("leaves to-do chats up until reminder data arrives", () => {
    expect(visibleChats(chats, [], state({ view: "today" }), false).map((chat) => chat.id)).toEqual([
      "room",
      "today",
      "later",
      "done",
      "pinned",
    ]);
  });
});
