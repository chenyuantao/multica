// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Reminder } from "@multica/core/types";
import {
  boardAfterCreate,
  dayGroups,
  dropPosition,
  endPosition,
  filterByTags,
  focusOpenReminder,
  moveTargets,
  pinnedReminders,
  reminderTags,
  sortDay,
  tagStats,
  viewReminders,
} from "./reminder-board";

function r(id: string, due: string | null, extra: Partial<Reminder> = {}): Reminder {
  return {
    id,
    workspace_id: "ws-1",
    identifier: id,
    title: id,
    description: "",
    creator_type: "member",
    creator_id: "u1",
    created_at: "2026-10-01T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [],
    pending_speakers: [],
    unread_count: 0,
    is_direct: false,
    pinned: false,
    status: "todo",
    due_date: due,
    position: 0,
    updated_at: "2026-10-01T00:00:00Z",
    pending: false,
    ...extra,
  };
}

const ids = (items: Reminder[]) => items.map((x) => x.id);
const today = new Date(2026, 9, 8);
const todayKey = "2026-10-08";

describe("reminder board", () => {
  const all = [
    r("mon", "2026-10-05"),
    r("thu", todayKey),
    r("nextweek", "2026-10-12"),
    r("pinned", "2026-09-01", { pending: true }),
    r("pinned-done", "2026-09-01", { pending: true, status: "done" }),
    r("undated", null),
    r("done-thu", todayKey, { status: "done" }),
  ];

  it("picks each view's reminders, with pinned open ones in every view but Completed", () => {
    expect(ids(viewReminders(all, "week", today, todayKey))).toEqual(["mon", "thu", "pinned", "done-thu"]);
    expect(ids(viewReminders(all, "today", today, todayKey))).toEqual(["thu", "pinned", "done-thu"]);
    expect(ids(viewReminders(all, "open", today, todayKey))).toEqual([
      "mon",
      "thu",
      "nextweek",
      "pinned",
      "pinned-done",
      "done-thu",
    ]);
    expect(ids(viewReminders(all, "done", today, todayKey))).toEqual(["pinned-done", "done-thu"]);
  });

  it("groups the week by day, keeps pinned ones out, and counts hidden finished ones", () => {
    const week = dayGroups(viewReminders(all, "week", today, todayKey), "week", today, todayKey, true);
    expect(week.map((g) => g.key)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(ids(week[3]!.items)).toEqual(["thu"]);
    expect(week[3]!.hiddenDone).toBe(1);
    expect(ids(pinnedReminders(viewReminders(all, "week", today, todayKey)))).toEqual(["pinned"]);

    const open = dayGroups(viewReminders(all, "open", today, todayKey), "open", today, todayKey, false);
    expect(open.map((g) => [g.key, ids(g.items)])).toEqual([
      ["2026-10-05", ["mon"]],
      ["2026-10-08", ["thu"]],
      ["2026-10-12", ["nextweek"]],
    ]);
    const done = dayGroups(viewReminders(all, "done", today, todayKey), "done", today, todayKey, false);
    expect(done.map((g) => g.key)).toEqual(["2026-10-08", "2026-09-01"]);
  });

  it("puts finished reminders first by time, then open ones by position", () => {
    const day = sortDay([
      r("b", todayKey, { position: 2 }),
      r("late-done", todayKey, { status: "done", updated_at: "2026-10-08T09:00:00Z" }),
      r("a", todayKey, { position: 1 }),
      r("early-done", todayKey, { status: "done", updated_at: "2026-10-08T08:00:00Z" }),
    ]);
    expect(ids(day)).toEqual(["early-done", "late-done", "a", "b"]);
  });

  it("reads hashtags, counts them, and filters by any chosen tag", () => {
    expect(reminderTags("#ops call #ops and #web, not a#b")).toEqual(["ops", "web,"]);
    const tagged = [
      r("x", todayKey, { title: "#ops ship" }),
      r("y", todayKey, { title: "#web #ops", status: "done" }),
      r("z", todayKey, { title: "plain" }),
    ];
    expect(tagStats(tagged)).toEqual([
      { tag: "ops", total: 2, completed: 1 },
      { tag: "web", total: 1, completed: 1 },
    ]);
    expect(ids(filterByTags(tagged, new Set(["web"]), null))).toEqual(["y"]);
    expect(ids(filterByTags(tagged, new Set(["web"]), "z"))).toEqual(["y", "z"]);
  });

  it("places added and dropped reminders between their open neighbours", () => {
    const day = [r("a", todayKey, { position: 1 }), r("b", todayKey, { position: 4 }), r("c", "2026-10-09", { position: 9 })];
    expect(endPosition(day, todayKey)).toBe(5);
    expect(endPosition(day, todayKey, new Set(["b"]))).toBe(2);
    expect(endPosition(day, "2026-10-10")).toBe(0);

    const byId = new Map(day.map((x) => [x.id, x]));
    expect(dropPosition(["a", "c", "b"], "c", byId)).toBe(2.5);
    expect(dropPosition(["c", "a", "b"], "c", byId)).toBe(0);
    expect(dropPosition(["a", "b", "c"], "c", byId)).toBe(5);
  });

  it("keeps a new reminder on screen by staying, or moving to its week", () => {
    const anchor = today;
    const nextWeek = new Date(2026, 9, 12);
    expect(boardAfterCreate("week", anchor, todayKey, todayKey)).toEqual({ filter: "week", anchor });
    expect(boardAfterCreate("week", nextWeek, todayKey, todayKey)).toMatchObject({ filter: "week" });
    expect(boardAfterCreate("week", nextWeek, todayKey, todayKey).anchor).toEqual(new Date(2026, 9, 8));
    expect(boardAfterCreate("today", anchor, todayKey, todayKey)).toEqual({ filter: "today", anchor });
    expect(boardAfterCreate("today", anchor, todayKey, "2026-10-09")).toMatchObject({ filter: "week" });
    expect(boardAfterCreate("today", anchor, todayKey, "2026-10-09").anchor).toEqual(new Date(2026, 9, 9));
    expect(boardAfterCreate("done", anchor, todayKey, "2026-10-12")).toMatchObject({ filter: "week" });
    expect(boardAfterCreate("done", anchor, todayKey, "2026-10-12").anchor).toEqual(new Date(2026, 9, 12));
    expect(boardAfterCreate("open", nextWeek, todayKey, "2026-10-20")).toEqual({ filter: "open", anchor: nextWeek });
    expect(boardAfterCreate("done", anchor, todayKey, null)).toEqual({ filter: "week", anchor });
  });

  it("lands on today's incomplete reminder, otherwise the nearest earlier day", () => {
    expect(focusOpenReminder([r("y", "2026-10-07"), r("t", todayKey), r("n", "2026-10-09")], todayKey)?.id).toBe("t");
    expect(
      focusOpenReminder(
        [
          r("y", "2026-10-07"),
          r("done", todayKey, { status: "done" }),
          r("n", "2026-10-09"),
        ],
        todayKey,
      )?.id,
    ).toBe("y");
    expect(focusOpenReminder([r("n", "2026-10-09"), r("far", "2026-10-20")], todayKey)?.id).toBe("n");
    expect(
      focusOpenReminder(
        [r("b", todayKey, { position: 2 }), r("a", todayKey, { position: 1 })],
        todayKey,
      )?.id,
    ).toBe("a");
    expect(focusOpenReminder([r("pin", todayKey, { pending: true }), r("n", "2026-10-09")], todayKey)?.id).toBe("pin");
    expect(focusOpenReminder([r("none", null), r("done", todayKey, { status: "done" })], todayKey)).toBeNull();
  });

  it("offers today, tomorrow, the coming Friday, and next Monday", () => {
    expect(moveTargets(today)).toEqual({
      today: "2026-10-08",
      tomorrow: "2026-10-09",
      friday: "2026-10-09",
      nextMonday: "2026-10-12",
    });
    expect(moveTargets(new Date(2026, 9, 12)).nextMonday).toBe("2026-10-19");
  });
});
