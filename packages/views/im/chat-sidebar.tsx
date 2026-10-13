"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Circle, CirclePlus, Eye, EyeOff, ListFilter, Pin, PinOff, X } from "lucide-react";
import { directChatPeer } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import { reminderListOptions } from "@multica/core/reminders";
import type { GroupChat, Reminder } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { Button } from "@multica/ui/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@multica/ui/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { useAppForeground } from "../common/use-app-foreground";
import { useT } from "../i18n";
import { chatDraftSummary, useChatDraft } from "./chat-draft";
import { cancelledNoticeTrigger } from "./cancelled-notice";
import { isChatHistoryContent } from "./chat-history";
import {
  chatFilterTagStats,
  isChatListFiltered,
  visibleChats,
  type ChatListFilterState,
  type ChatScope,
} from "./chat-list-filter";
import { readChatListFilter, writeChatListFilter } from "./chat-list-filter-memory";
import { chatActivityAt, chatDisplayTitle, formatStamp, plainTextPreview } from "./im-utils";
import { ImSidebarSearch } from "./im-sidebar-search";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";
import { addDays, fromDateKey, startOfWeek, toDateKey, weekCode } from "./reminder-dates";
import type { ReminderFilter } from "./reminder-board";
import { UnreadBadge } from "./unread-badge";

interface ChatSidebarProps {
  chats: GroupChat[];
  isLoading: boolean;
  isError: boolean;
  selectedId: string | null;
  userId: string;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  onSetPinned: (chatId: string, pinned: boolean) => void;
  /** Checks a task chat off, or opens it again. */
  onSetDone: (chatId: string, done: boolean) => void;
  /** Phones open the shared search page instead of filtering this list. */
  onOpenSearch?: () => void;
  /** Phones get the iOS menu look on long press. */
  iosMenu?: boolean;
  /** Phone-only control in the top-left of the list header. */
  leading?: React.ReactNode;
  className?: string;
}

export function ChatSidebar({
  chats,
  isLoading,
  isError,
  selectedId,
  userId,
  onSelect,
  onNewChat,
  onSetPinned,
  onSetDone,
  onOpenSearch,
  iosMenu,
  leading,
  className,
}: ChatSidebarProps) {
  const { t } = useT("im");
  const wsId = useWorkspaceId();
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const [filterWs, setFilterWs] = useState(wsId);
  const [filter, setFilter] = useState<ChatListFilterState>(() => readChatListFilter(wsId, todayKey));
  if (wsId !== filterWs) {
    setFilterWs(wsId);
    setFilter(readChatListFilter(wsId, todayKey));
  }
  useEffect(() => {
    writeChatListFilter(wsId, filter);
  }, [filter, wsId]);
  const reminders = useQuery(reminderListOptions(wsId, {}));
  const reminderRows = reminders.data ?? EMPTY_REMINDERS;
  const visible = useMemo(
    () => visibleChats(chats, reminderRows, filter, reminders.data !== undefined),
    [chats, filter, reminderRows, reminders.data],
  );
  const filtered = isChatListFiltered(filter);
  // The open chat is read as soon as it lands while the app is in front, so
  // its badge would only flash; in the background it stays visible.
  const foreground = useAppForeground();
  const readingId = foreground ? selectedId : null;

  return (
    <ImSidebarShell className={className}>
      <ImSidebarHeader
        title={t(($) => $.tabs.chats)}
        onOpenSearch={onOpenSearch}
        desktopSearch={<ImSidebarSearch priority="chats" onOpenChat={onSelect} />}
        leading={leading}
      >
        <div className="flex shrink-0 items-center gap-1">
          <ChatListFilter
            state={filter}
            reminders={reminderRows}
            active={filtered}
            onChange={setFilter}
          />
          <button
            type="button"
            onClick={onNewChat}
            aria-label={t(($) => $.sidebar.new_chat)}
            title={t(($) => $.sidebar.new_chat)}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <CirclePlus className="size-[21px]" strokeWidth={1.7} />
          </button>
        </div>
      </ImSidebarHeader>

      <nav className="min-h-0 flex-1 overflow-y-auto pt-1 pb-3" aria-label={t(($) => $.sidebar.chats)}>
        {isError ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.sidebar.load_failed)}</p>
        ) : !isLoading && visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">
            {filtered && chats.length > 0 ? t(($) => $.sidebar.filter_empty) : t(($) => $.sidebar.empty)}
          </p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((chat) => (
              <li key={chat.id} className="border-b border-foreground/5 last:border-b-0">
                <ChatListMenu
                  pinned={chat.pinned}
                  task={chat.task}
                  done={chat.status === "done"}
                  ios={iosMenu}
                  onSetPinned={(pinned) => onSetPinned(chat.id, pinned)}
                  onSetDone={(done) => onSetDone(chat.id, done)}
                >
                  <ChatListItem
                    chat={chat}
                    userId={userId}
                    selected={chat.id === selectedId}
                    unread={chat.id === readingId ? 0 : chat.unread_count}
                    onSelect={() => onSelect(chat.id)}
                    onSetDone={(done) => onSetDone(chat.id, done)}
                  />
                </ChatListMenu>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </ImSidebarShell>
  );
}

const EMPTY_REMINDERS: Reminder[] = [];

const VIEWS: ReminderFilter[] = ["today", "week", "open", "done"];

const SCOPES: ChatScope[] = ["all", "todo", "other"];

/**
 * Floating filter for the chat list. The reminder views, week, tags, and
 * completed switch match the to-do page. Scope adds only to-dos or only
 * other chats.
 */
function ChatListFilter({
  state,
  reminders,
  active,
  onChange,
}: {
  state: ChatListFilterState;
  reminders: Reminder[];
  active: boolean;
  onChange: (state: ChatListFilterState) => void;
}) {
  const { t } = useT("im");
  const stats = chatFilterTagStats(reminders, state);
  const chooseScope = (scope: ChatScope) => onChange({ ...state, scope });
  const chooseView = (view: ReminderFilter) => onChange({ ...state, view: state.view === view ? null : view });
  const toggleTag = (tag: string) => {
    const tags = new Set(state.tags);
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    onChange({ ...state, tags });
  };
  const scopeLabel = (scope: ChatScope) =>
    scope === "todo" ? t(($) => $.sidebar.only_todos) : scope === "other" ? t(($) => $.sidebar.non_todos) : t(($) => $.sidebar.all_chats);
  const showCompletedSwitch = state.view === "today" || state.view === "week";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-pressed={active}
            aria-label={t(($) => $.sidebar.filter)}
            title={t(($) => $.sidebar.filter)}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active ? "bg-foreground/8 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          />
        }
      >
        <ListFilter className="size-[18px]" strokeWidth={1.7} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        <div role="group" aria-label={t(($) => $.sidebar.filter)} className="flex flex-wrap gap-1.5">
          {SCOPES.map((scope) => (
            <Button
              key={scope}
              type="button"
              size="xs"
              variant={state.scope === scope ? "brand" : "secondary"}
              aria-pressed={state.scope === scope}
              onClick={() => chooseScope(scope)}
            >
              {scopeLabel(scope)}
            </Button>
          ))}
        </div>
        <div role="group" aria-label={t(($) => $.reminder.filters)} className="flex flex-wrap gap-1.5">
          {VIEWS.map((view) => (
            <Button
              key={view}
              type="button"
              size="xs"
              variant={state.view === view ? "brand" : "secondary"}
              aria-pressed={state.view === view}
              onClick={() => chooseView(view)}
            >
              {t(($) => $.reminder[view])}
            </Button>
          ))}
        </div>
        {state.view === "week" && (
          <div className="flex items-center gap-1">
            <span className="min-w-[7.5rem] text-label font-medium tabular-nums">{weekCode(state.anchor)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onChange({ ...state, anchor: addDays(state.anchor, -7) })}
              aria-label={t(($) => $.reminder.prev_week)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onChange({ ...state, anchor: addDays(state.anchor, 7) })}
              aria-label={t(($) => $.reminder.next_week)}
            >
              <ChevronRight />
            </Button>
            {toDateKey(startOfWeek(state.anchor)) !== toDateKey(startOfWeek(fromDateKey(state.todayKey))) && (
              <Button type="button" variant="outline" size="xs" onClick={() => onChange({ ...state, anchor: fromDateKey(state.todayKey) })}>
                {t(($) => $.reminder.current_week)}
              </Button>
            )}
          </div>
        )}
        {(showCompletedSwitch || stats.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {showCompletedSwitch && (
              <Button
                type="button"
                size="xs"
                variant={state.hideCompleted ? "brand" : "ghost"}
                aria-pressed={state.hideCompleted}
                aria-label={state.hideCompleted ? t(($) => $.reminder.show_completed) : t(($) => $.reminder.hide_completed)}
                onClick={() => onChange({ ...state, hideCompleted: !state.hideCompleted })}
              >
                {state.hideCompleted ? <EyeOff /> : <Eye />}
                {state.hideCompleted ? t(($) => $.reminder.show_completed) : t(($) => $.reminder.hide_completed)}
              </Button>
            )}
            {state.tags.size > 0 && (
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t(($) => $.reminder.clear_tags)} onClick={() => onChange({ ...state, tags: new Set() })}>
                <X />
              </Button>
            )}
          </div>
        )}
        {stats.length > 0 && (
          <div role="group" aria-label={t(($) => $.reminder.tag_filters)} className="flex flex-wrap gap-1.5">
            {stats.map(({ tag, total, completed }) => {
              const on = state.tags.has(tag);
              return (
                <Button
                  key={tag}
                  type="button"
                  size="xs"
                  variant={on ? "brand" : "outline"}
                  aria-pressed={on}
                  onClick={() => toggleTag(tag)}
                >
                  <span className="max-w-32 truncate">#{tag}</span>
                  <span className="tabular-nums">
                    {completed}/{total}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const MOSAIC_SIZE = 40;
const MOSAIC_PADDING = 2;
const MOSAIC_GAP = 1.5;
const MOSAIC_MAX_TILES = 9;

/**
 * Group avatar: a messenger-style mosaic of up to nine members on a grey
 * plate. You always take the last tile so you stay visible in large rooms;
 * an incomplete last row is centered. A two-person chat shows the other side.
 */
export function ChatAvatar({ chat, userId }: { chat: GroupChat; userId: string }) {
  const peer = directChatPeer(chat, userId);
  if (peer) {
    return <ActorAvatar actorType={peer.member_type} actorId={peer.member_id} size="xl" profileLink={false} />;
  }
  const isSelf = (m: GroupChat["members"][number]) => m.member_type === "member" && m.member_id === userId;
  const self = chat.members.find(isSelf);
  const others = chat.members.filter((m) => !isSelf(m));
  const shown = [...others.slice(0, MOSAIC_MAX_TILES - (self ? 1 : 0)), ...(self ? [self] : [])];
  if (shown.length <= 1) {
    const only = shown[0];
    return only ? (
      <ActorAvatar actorType={only.member_type} actorId={only.member_id} size="xl" profileLink={false} />
    ) : (
      <span className="size-10 shrink-0 rounded-avatar bg-muted" />
    );
  }
  const columns = shown.length <= 4 ? 2 : 3;
  const tile = (MOSAIC_SIZE - MOSAIC_PADDING * 2 - (columns - 1) * MOSAIC_GAP) / columns;
  return (
    <span
      className="flex size-10 shrink-0 flex-wrap content-center items-center justify-center overflow-hidden rounded-avatar bg-input"
      style={{ padding: MOSAIC_PADDING, gap: MOSAIC_GAP }}
    >
      {shown.map((m) => (
        <span key={`${m.member_type}:${m.member_id}`} className="flex overflow-hidden rounded-[2px]">
          <ActorAvatar actorType={m.member_type} actorId={m.member_id} size={tile} shape="square" profileLink={false} />
        </span>
      ))}
    </span>
  );
}

/** Right click, or a long press on a touch screen, opens a chat's list actions. */
function ChatListMenu({
  pinned,
  task,
  done,
  ios,
  onSetPinned,
  onSetDone,
  children,
}: {
  pinned: boolean;
  task: boolean;
  done: boolean;
  ios?: boolean;
  onSetPinned: (pinned: boolean) => void;
  onSetDone: (done: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useT("im");
  const PinIcon = pinned ? PinOff : Pin;
  const pinLabel = pinned ? t(($) => $.sidebar.unpin) : t(($) => $.sidebar.pin);
  const doneLabel = done ? t(($) => $.sidebar.mark_open) : t(($) => $.sidebar.mark_done);
  const itemClass = cn(ios && "h-11 justify-between rounded-none px-4 text-body-lg [&_svg:not([class*='size-'])]:size-5");
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block [-webkit-touch-callout:none] data-[popup-open]:bg-foreground/5">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className={cn(ios && "min-w-56 rounded-[14px] bg-surface-raised/85 p-0 backdrop-blur-xl")}
      >
        {task && (
          <ContextMenuItem onClick={() => onSetDone(!done)} className={itemClass}>
            {ios ? (
              <>
                {doneLabel}
                <Check />
              </>
            ) : (
              <>
                <Check />
                {doneLabel}
              </>
            )}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onSetPinned(!pinned)} className={itemClass}>
          {ios ? (
            <>
              {pinLabel}
              <PinIcon />
            </>
          ) : (
            <>
              <PinIcon />
              {pinLabel}
            </>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ChatListItem({
  chat,
  userId,
  selected,
  unread,
  onSelect,
  onSetDone,
}: {
  chat: GroupChat;
  userId: string;
  selected: boolean;
  unread: number;
  onSelect: () => void;
  onSetDone: (done: boolean) => void;
}) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const storedDraft = useChatDraft(chat.id);
  // The open chat already shows the composer, so its draft stays out of the list.
  const draft = selected ? "" : chatDraftSummary(storedDraft);
  const last = chat.last_message;
  const text = !last
    ? ""
    : cancelledNoticeTrigger(last.content) !== null
      ? t(($) => $.thread.cancelled_in_progress)
      : isChatHistoryContent(last.content)
        ? t(($) => $.thread.history_footer)
        : plainTextPreview(last.content);
  const preview = !last
    ? t(($) => $.sidebar.no_messages)
    : last.author_type === "system" || directChatPeer(chat, userId)
      ? text
      : t(($) => $.sidebar.preview, { name: getActorName(last.author_type, last.author_id), text });
  const title = chatDisplayTitle(chat, userId, getActorName);
  const taskDone = chat.task && chat.status === "done";
  const taskStatusLabel = taskDone ? t(($) => $.sidebar.mark_open) : t(($) => $.sidebar.mark_done);

  return (
    <div
      className={cn(
        "relative flex h-[66px] w-full items-center gap-[11px] px-4.5 transition-colors",
        selected ? "bg-brand/12 hover:bg-brand/12" : "hover:bg-foreground/5",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-labelledby={`chat-list-title-${chat.id}`}
        className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      />
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-[11px]">
        <ChatAvatar chat={chat} userId={userId} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span
                id={`chat-list-title-${chat.id}`}
                className={cn("min-w-0 truncate text-body", selected || unread > 0 ? "font-semibold" : "font-medium")}
              >
                {title}
              </span>
              {chat.task && (
                <button
                  type="button"
                  onClick={() => onSetDone(!taskDone)}
                  aria-pressed={taskDone}
                  aria-label={taskStatusLabel}
                  title={taskStatusLabel}
                  className={cn(
                    "pointer-events-auto -m-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    taskDone ? "text-info" : "text-muted-foreground",
                  )}
                >
                  {taskDone ? (
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-info/15">
                      <Check className="size-3 text-info" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <Circle className="size-4" strokeWidth={1.8} />
                  )}
                </button>
              )}
            </span>
            {chat.pinned && (
              <Pin
                role="img"
                aria-label={t(($) => $.sidebar.pinned)}
                className="size-3 shrink-0 self-center text-muted-foreground"
              />
            )}
            <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
              {formatStamp(chatActivityAt(chat), new Date(), (time) => t(($) => $.thread.yesterday, { time }))}
            </span>
          </span>
          <span className="mt-[3px] flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-caption", unread > 0 ? "text-foreground" : "text-muted-foreground")}>
              {draft ? (
                <>
                  <span className="text-destructive">{t(($) => $.sidebar.draft)}</span>
                  {` ${draft}`}
                </>
              ) : (
                preview
              )}
            </span>
            <UnreadBadge count={unread} label={t(($) => $.sidebar.unread, { count: unread })} />
          </span>
        </span>
      </div>
    </div>
  );
}
