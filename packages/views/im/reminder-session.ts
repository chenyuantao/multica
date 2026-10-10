import type { ReminderFilter } from "./reminder-board";

/**
 * Which reminder conversation this workspace has open on the desktop page.
 * Absence means the page has not chosen yet. `null` means the user closed it.
 * Kept in memory for the tab, so leaving and returning does not start over.
 *
 * The board view is kept the same way: Today (or another filter) and the week
 * being shown survive leaving the page and switching filters. Absence means
 * the page is still on this week, so the first visit can still choose where
 * to land.
 *
 * Hiding completed reminders and the active tags are kept apart from the
 * board, so they never stop the first visit from choosing where to land.
 */
const openByWorkspace = new Map<string, string | null>();

export interface ReminderBoardMemory {
  filter: ReminderFilter;
  /** `YYYY-MM-DD` of a day in the week the week view was showing. */
  anchorKey: string;
}

const boardByWorkspace = new Map<string, ReminderBoardMemory>();

export interface ReminderListMemory {
  hideCompleted: boolean;
  tags: ReadonlySet<string>;
}

const listByWorkspace = new Map<string, ReminderListMemory>();

export function reminderOpenId(wsId: string): string | null | undefined {
  return openByWorkspace.has(wsId) ? openByWorkspace.get(wsId)! : undefined;
}

export function rememberReminderOpen(wsId: string, id: string | null): void {
  openByWorkspace.set(wsId, id);
}

export function reminderBoard(wsId: string): ReminderBoardMemory | undefined {
  return boardByWorkspace.get(wsId);
}

export function rememberReminderBoard(wsId: string, board: ReminderBoardMemory): void {
  boardByWorkspace.set(wsId, board);
}

export function forgetReminderBoard(wsId: string): void {
  boardByWorkspace.delete(wsId);
}

export function reminderListMemory(wsId: string): ReminderListMemory | undefined {
  return listByWorkspace.get(wsId);
}

export function rememberReminderList(wsId: string, memory: ReminderListMemory): void {
  if (!memory.hideCompleted && memory.tags.size === 0) listByWorkspace.delete(wsId);
  else listByWorkspace.set(wsId, memory);
}

export function resetReminderOpenMemory(): void {
  openByWorkspace.clear();
  boardByWorkspace.clear();
  listByWorkspace.clear();
}
