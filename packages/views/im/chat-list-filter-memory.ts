import { defaultStorage } from "@multica/core/platform";
import type { StorageAdapter } from "@multica/core/types";
import type { ChatListFilterState, ChatScope } from "./chat-list-filter";
import type { ReminderFilter } from "./reminder-board";
import { fromDateKey } from "./reminder-dates";

const KEY_PREFIX = "multica:im-chat-filter:";

const SCOPES = new Set<ChatScope>(["all", "todo", "other"]);
const VIEWS = new Set<ReminderFilter>(["today", "week", "open", "done"]);

function storageKey(wsId: string): string {
  return `${KEY_PREFIX}${wsId}`;
}

function defaultFilter(todayKey: string): ChatListFilterState {
  return {
    scope: "all",
    view: null,
    anchor: fromDateKey(todayKey),
    todayKey,
    tags: new Set(),
    hideCompleted: false,
  };
}

/** The last chat-list filter for this workspace, or the unfiltered default. */
export function readChatListFilter(
  wsId: string,
  todayKey: string,
  storage: StorageAdapter = defaultStorage,
): ChatListFilterState {
  const base = defaultFilter(todayKey);
  if (!wsId) return base;
  const raw = storage.getItem(storageKey(wsId));
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as {
      scope?: unknown;
      view?: unknown;
      tags?: unknown;
      hideCompleted?: unknown;
      anchorKey?: unknown;
    };
    const scope = SCOPES.has(parsed.scope as ChatScope) ? (parsed.scope as ChatScope) : base.scope;
    const view = parsed.view == null ? null : VIEWS.has(parsed.view as ReminderFilter) ? (parsed.view as ReminderFilter) : null;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
      : [];
    const anchorKey = typeof parsed.anchorKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.anchorKey)
      ? parsed.anchorKey
      : todayKey;
    return {
      scope,
      view,
      anchor: fromDateKey(anchorKey),
      todayKey,
      tags: new Set(tags),
      hideCompleted: parsed.hideCompleted === true,
    };
  } catch {
    return base;
  }
}

/** Remembers the filter. `todayKey` is not stored; the next visit uses that day's date. */
export function writeChatListFilter(
  wsId: string,
  state: ChatListFilterState,
  storage: StorageAdapter = defaultStorage,
): void {
  if (!wsId) return;
  const anchorKey = [
    state.anchor.getFullYear(),
    String(state.anchor.getMonth() + 1).padStart(2, "0"),
    String(state.anchor.getDate()).padStart(2, "0"),
  ].join("-");
  storage.setItem(
    storageKey(wsId),
    JSON.stringify({
      scope: state.scope,
      view: state.view,
      tags: [...state.tags],
      hideCompleted: state.hideCompleted,
      anchorKey,
    }),
  );
}
