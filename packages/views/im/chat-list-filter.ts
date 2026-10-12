import type { Reminder } from "@multica/core/types";
import {
  dayGroups,
  filterByTags,
  pinnedReminders,
  tagStats,
  viewReminders,
  type ReminderFilter,
  type TagStat,
} from "./reminder-board";

/** Which chats the list keeps before the reminder view narrows the to-dos. */
export type ChatScope = "all" | "todo" | "other";

export interface ChatListFilterState {
  scope: ChatScope;
  /** Unset until a reminder view is chosen. The chat list stays complete until then. */
  view: ReminderFilter | null;
  anchor: Date;
  todayKey: string;
  tags: ReadonlySet<string>;
  hideCompleted: boolean;
}

export function isChatListFiltered(state: Pick<ChatListFilterState, "scope" | "view" | "tags">): boolean {
  return state.scope !== "all" || state.view !== null || state.tags.size > 0;
}

/** Tag totals for the floating filter. A chosen view uses that view's reminders. */
export function chatFilterTagStats(reminders: Reminder[], state: ChatListFilterState): TagStat[] {
  const source = state.view
    ? viewReminders(reminders, state.view, state.anchor, state.todayKey)
    : reminders;
  return tagStats(source);
}

/**
 * Reminder rows the to-do page would paint for this view: pinned rows stay
 * above the days, and completed rows drop out of Today and This week when
 * that switch is on.
 */
function shownReminders(reminders: Reminder[], state: ChatListFilterState): Reminder[] {
  const view = state.view;
  if (!view) return filterByTags(reminders, state.tags, null);
  const viewed = filterByTags(viewReminders(reminders, view, state.anchor, state.todayKey), state.tags, null);
  const hide = (view === "today" || view === "week") && state.hideCompleted;
  const rows = dayGroups(viewed, view, state.anchor, state.todayKey, hide).flatMap((day) => day.items);
  if (view === "done") return rows;
  return [...pinnedReminders(viewed), ...rows];
}

/**
 * Chats left after the floating filter. Non-to-dos ignore the reminder view.
 * "Only non-to-dos" keeps just those. Until reminder data arrives, a view or
 * tag does not hide to-do chats.
 */
export function visibleChats<T extends { id: string; task: boolean }>(
  chats: readonly T[],
  reminders: Reminder[],
  state: ChatListFilterState,
  remindersReady: boolean,
): T[] {
  if (state.scope === "other") return chats.filter((chat) => !chat.task);
  const narrowing = state.view !== null || state.tags.size > 0;
  const allowed =
    narrowing && remindersReady ? new Set(shownReminders(reminders, state).map((reminder) => reminder.id)) : null;
  return chats.filter((chat) => {
    if (!chat.task) return state.scope === "all";
    return allowed === null || allowed.has(chat.id);
  });
}
