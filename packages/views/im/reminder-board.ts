import type { Reminder } from "@multica/core/types";
import { addDays, startOfWeek, toDateKey } from "./reminder-dates";

export type ReminderFilter = "week" | "today" | "open" | "done";

export const isDone = (r: Reminder) => r.status === "done";
export const dueKey = (r: Reminder) => (r.due_date ? r.due_date.slice(0, 10) : null);
/** Pinned and unfinished: shown above the days instead of under one. */
export const isPinned = (r: Reminder) => r.pending && !isDone(r);

/**
 * The reminders a view covers, before tag filtering. Pinned reminders join
 * every view but Completed; Open also counts finished dated ones so its tag
 * totals match the days they came from.
 */
export function viewReminders(all: Reminder[], filter: ReminderFilter, anchor: Date, todayKey: string): Reminder[] {
  if (filter === "done") return all.filter(isDone);
  if (filter === "open") return all.filter((r) => isPinned(r) || dueKey(r) !== null);
  if (filter === "today") return all.filter((r) => isPinned(r) || dueKey(r) === todayKey);
  const monday = startOfWeek(anchor);
  const from = toDateKey(monday);
  const to = toDateKey(addDays(monday, 6));
  return all.filter((r) => {
    if (isPinned(r)) return true;
    const key = dueKey(r);
    return key !== null && key >= from && key <= to;
  });
}

/** Finished first (oldest change first), then the open ones in their saved order. */
export function sortDay(items: Reminder[]): Reminder[] {
  return [...items].sort((a, b) => {
    const aDone = isDone(a);
    const bDone = isDone(b);
    if (aDone !== bDone) return aDone ? -1 : 1;
    if (aDone) return a.updated_at.localeCompare(b.updated_at);
    return a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}

export interface DayGroup {
  key: string;
  items: Reminder[];
  /** Finished reminders left out while completed ones are hidden. */
  hiddenDone: number;
}

export function dayGroups(
  items: Reminder[],
  filter: ReminderFilter,
  anchor: Date,
  todayKey: string,
  hideCompleted: boolean,
): DayGroup[] {
  const dated = items.filter((r) => !isPinned(r) && dueKey(r) !== null);
  const day = (key: string): DayGroup => {
    const all = dated.filter((r) => dueKey(r) === key);
    const shown = hideCompleted ? all.filter((r) => !isDone(r)) : all;
    return { key, items: sortDay(shown), hiddenDone: all.length - shown.length };
  };
  if (filter === "week") {
    const monday = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => day(toDateKey(addDays(monday, i))));
  }
  if (filter === "today") return [day(todayKey)];

  const done = filter === "done";
  const byDay = new Map<string, Reminder[]>();
  for (const r of dated) {
    if (isDone(r) !== done) continue;
    const key = dueKey(r)!;
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (done ? b.localeCompare(a) : a.localeCompare(b)))
    .map(([key, rows]) => ({ key, items: sortDay(rows), hiddenDone: 0 }));
}

export function pinnedReminders(items: Reminder[]): Reminder[] {
  return sortDay(items.filter(isPinned));
}

/** `#tag` words in a title, in order of first use. */
export function reminderTags(title: string): string[] {
  const tags: string[] = [];
  for (const match of title.matchAll(/(?:^|\s)#([^\s#]+)/g)) {
    const tag = match[1]!;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export interface TagStat {
  tag: string;
  total: number;
  completed: number;
}

export function tagStats(items: Reminder[]): TagStat[] {
  const stats = new Map<string, TagStat>();
  for (const r of items) {
    for (const tag of reminderTags(r.title)) {
      const stat = stats.get(tag) ?? { tag, total: 0, completed: 0 };
      stat.total += 1;
      if (isDone(r)) stat.completed += 1;
      stats.set(tag, stat);
    }
  }
  return [...stats.values()];
}

/** Reminders carrying any of the tags. The one being edited always stays. */
export function filterByTags(items: Reminder[], tags: ReadonlySet<string>, keepId: string | null): Reminder[] {
  if (tags.size === 0) return items;
  return items.filter((r) => r.id === keepId || reminderTags(r.title).some((tag) => tags.has(tag)));
}

/** Position after every reminder already on the day, leaving out `moving`. */
export function endPosition(all: Reminder[], key: string, moving: ReadonlySet<string> = new Set()): number {
  const positions = all.filter((r) => dueKey(r) === key && !moving.has(r.id)).map((r) => r.position);
  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}

export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 0;
}

/**
 * Position for `id` dropped into `orderedIds`, from the open neighbours
 * around it; finished rows sort by time and do not anchor the order.
 */
export function dropPosition(orderedIds: string[], id: string, byId: Map<string, Reminder>): number {
  const index = orderedIds.indexOf(id);
  const open = (ids: string[]) => ids.map((x) => byId.get(x)).filter((r): r is Reminder => !!r && !isDone(r));
  const before = open(orderedIds.slice(0, index)).at(-1)?.position;
  const after = open(orderedIds.slice(index + 1))[0]?.position;
  return positionBetween(before, after);
}

/** Days the move menu offers: today, tomorrow, the coming Friday, and next Monday. */
export function moveTargets(today: Date): { today: string; tomorrow: string; friday: string; nextMonday: string } {
  const day = today.getDay();
  return {
    today: toDateKey(today),
    tomorrow: toDateKey(addDays(today, 1)),
    friday: toDateKey(addDays(today, (5 - day + 7) % 7)),
    nextMonday: toDateKey(addDays(today, (1 - day + 7) % 7 || 7)),
  };
}
