"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Flag,
  List,
  ListTodo,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@multica/core/auth";
import { useGroupChatRealtime } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  reminderListOptions,
  useCreateReminder,
  useDeleteReminders,
  useReminderRealtime,
  useSetRemindersPending,
  useUpdateReminders,
} from "@multica/core/reminders";
import type { Agent, Reminder } from "@multica/core/types";
import { agentListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { cn } from "@multica/ui/lib/utils";
import { useAppForeground } from "../common/use-app-foreground";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { DragStrip } from "../platform";
import { useDetailsColumnWidth } from "./use-details-column-width";
import { ChatProgressRoute } from "./chat-progress-view";
import { ChatThread } from "./chat-thread";
import { ImRail } from "./im-rail";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";
import { resolveTitleMentions, type ComposerMention } from "./im-utils";
import { MobileContactDetail, MobileLevel, MobileTabScreen, parseContactParam } from "./mobile-shell";
import {
  boardAfterCreate,
  dueKey,
  endPosition,
  filterByTags,
  focusOpenReminder,
  reminderTags,
  tagStats,
  viewReminders,
  type ReminderFilter,
  type TagStat,
} from "./reminder-board";
import { addDays, fromDateKey, startOfWeek, toDateKey, weekCode } from "./reminder-dates";
import { ReminderList, type ReminderListActions } from "./reminder-list";
import { rememberReminderOpen, reminderOpenId } from "./reminder-session";
import { ColumnResizeHandle } from "./resizable-column";

const EMPTY_REMINDERS: Reminder[] = [];
const EMPTY_AGENTS: Agent[] = [];

const FILTERS = [
  { id: "week", icon: List, dot: "bg-info" },
  { id: "today", icon: Calendar, dot: "bg-warning" },
  { id: "open", icon: CalendarClock, dot: "bg-brand" },
  { id: "done", icon: Flag, dot: "bg-destructive" },
] as const;

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

/**
 * Reminders: each one is a chat that never shows in `/im`. Its title is the
 * to-do, the messages are its details, and an @ in the title or a message
 * assigns an agent without a separate hand-off.
 * Desktop opens a reminder's messages in a resizable column on the right;
 * a phone keeps the list inside Me and opens a reminder as its own level.
 *
 * The first visit lands on today's incomplete reminder, or the nearest other
 * day's. That choice stays in memory: switching sections keeps this tree
 * mounted, and a later visit reopens the same conversation.
 * Creating a reminder opens its conversation at once, focuses the composer,
 * and brings that row into view, moving the week or filter when the row
 * would otherwise be hidden.
 */
export function ReminderPage({ active = true }: { active?: boolean }) {
  const { t } = useT("im");
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const isMobile = useIsMobile();
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [filter, setFilter] = useState<ReminderFilter>("week");
  const [anchor, setAnchor] = useState<Date>(today);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [activeTags, setActiveTags] = useState<ReadonlySet<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scrollToId, setScrollToId] = useState<string | null>(() => reminderOpenId(wsId) || null);
  /** The conversation whose composer should take focus. Only a just-created reminder. */
  const [composerFocusId, setComposerFocusId] = useState<string | null>(null);
  const choseFocus = useRef(false);
  /** Set while a conversation open is waiting for the URL to catch up. */
  const openingId = useRef<string | null>(null);
  /** The reminder just created, so its conversation can open before the list query includes it. */
  const pendingCreated = useRef<Reminder | null>(null);

  const list = useQuery(reminderListOptions(wsId, {}));
  const all = list.data ?? EMPTY_REMINDERS;
  const view = useMemo(() => viewReminders(all, filter, anchor, todayKey), [all, filter, anchor, todayKey]);
  const stats = useMemo(() => tagStats(view), [view]);
  const items = useMemo(() => filterByTags(view, activeTags, editingId), [view, activeTags, editingId]);
  const requestedId = active ? navigation.searchParams.get("item") : null;
  const rememberedId = reminderOpenId(wsId);
  const openId = requestedId ?? (rememberedId || null);
  const listed = openId ? all.find((r) => r.id === openId) ?? null : null;
  if (listed && pendingCreated.current?.id === listed.id) pendingCreated.current = null;
  const selected = listed ?? (openId && pendingCreated.current?.id === openId ? pendingCreated.current : null);
  // The open conversation is read while it is on screen, so its badge would
  // only flash. A phone list after leaving the thread, a hidden page, and a
  // backgrounded window keep the stored count.
  const foreground = useAppForeground();
  const readingId =
    active && foreground && selected && (!isMobile || requestedId !== null) ? selected.id : null;

  const navRef = useRef(navigation);
  navRef.current = navigation;
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const itemInUrl = requestedId ?? "";
  useEffect(() => {
    if (!active) return;
    const nav = navRef.current;
    const urlId = nav.searchParams.get("item");
    if (openingId.current) {
      if (urlId !== openingId.current) return;
      openingId.current = null;
    }
    if (urlId) {
      rememberReminderOpen(wsId, urlId);
      setScrollToId((current) => current ?? urlId);
      return;
    }
    const remembered = reminderOpenId(wsId);
    if (remembered !== undefined) {
      if (list.isPending) return;
      if (!isMobile && remembered && all.some((r) => r.id === remembered)) {
        setScrollToId((current) => current ?? remembered);
        nav.replace(pathsRef.current.reminderItem(remembered));
      }
      return;
    }
    if (list.isPending || choseFocus.current) return;
    choseFocus.current = true;
    const target = focusOpenReminder(all, todayKey);
    if (isMobile) {
      if (target) setScrollToId(target.id);
      return;
    }
    rememberReminderOpen(wsId, target?.id ?? null);
    if (!target) return;
    setScrollToId(target.id);
    const key = dueKey(target);
    if (key) {
      const weekStart = startOfWeek(today);
      const monday = toDateKey(weekStart);
      const sunday = toDateKey(addDays(weekStart, 6));
      if (key < monday || key > sunday) setAnchor(fromDateKey(key));
    }
    nav.replace(pathsRef.current.reminderItem(target.id));
  }, [active, all, isMobile, itemInUrl, list.isPending, today, todayKey, wsId]);

  const { data: agents = EMPTY_AGENTS } = useQuery(agentListOptions(wsId));
  const mentionCandidates = useMemo<ComposerMention[]>(
    () => agents.filter((a) => !a.archived_at).map((a) => ({ type: "agent", id: a.id, name: a.name })),
    [agents],
  );
  const create = useCreateReminder(wsId);
  const update = useUpdateReminders(wsId);
  const setPending = useSetRemindersPending(wsId);
  const remove = useDeleteReminders(wsId);

  useGroupChatRealtime(wsId);
  useReminderRealtime(wsId);

  const close = () => {
    openingId.current = null;
    rememberReminderOpen(wsId, null);
    navigation.replace(paths.reminder());
  };
  const openConversation = (id: string, opts?: { focusComposer?: boolean }) => {
    openingId.current = id;
    rememberReminderOpen(wsId, id);
    setScrollToId(id);
    setComposerFocusId(opts?.focusComposer ? id : null);
    if (isMobile) navigation.push(paths.reminderItem(id));
    else navigation.replace(paths.reminderItem(id));
  };
  const actions: ReminderListActions = {
    open: openConversation,
    update: (updates) => update.mutate(updates, { onError: () => toast.error(t(($) => $.reminder.update_failed)) }),
    setPending: (ids, pending) =>
      setPending.mutate({ ids, pending }, { onError: () => toast.error(t(($) => $.reminder.update_failed)) }),
    remove: (ids) =>
      remove.mutate(ids, {
        onSuccess: () => {
          const open = navigation.searchParams.get("item");
          if (open && ids.includes(open)) close();
        },
        onError: () => toast.error(t(($) => $.reminder.delete_failed)),
      }),
    create: (title, due, position) =>
      create.mutateAsync({ title, due_date: due, position }).then(
        (created) => {
          const next = boardAfterCreate(filter, anchor, todayKey, due);
          if (next.filter !== filter) setFilter(next.filter);
          if (toDateKey(next.anchor) !== toDateKey(anchor)) setAnchor(next.anchor);
          if (activeTags.size > 0 && !reminderTags(created.title).some((tag) => activeTags.has(tag))) {
            setActiveTags(new Set());
          }
          pendingCreated.current = created;
          openConversation(created.id, { focusComposer: true });
          return true;
        },
        () => {
          toast.error(t(($) => $.reminder.create_failed));
          return false;
        },
      ),
  };

  // Pasting anywhere outside a text field adds the text as a reminder for today.
  // A pasted `@Name` that matches one agent is the assignment.
  const pasteRef = useRef({ all, create: actions.create, todayKey, candidates: mentionCandidates });
  useEffect(() => {
    pasteRef.current = { all, create: actions.create, todayKey, candidates: mentionCandidates };
  });
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement)) return;
      const text = e.clipboardData?.getData("text/plain").trim();
      if (!text) return;
      e.preventDefault();
      const { all: current, create: add, todayKey: key, candidates } = pasteRef.current;
      const resolved = resolveTitleMentions(text, [], candidates);
      void add(resolved.ok ? resolved.markdown : text, key, endPosition(current, key));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [active]);

  const chooseFilter = (next: ReminderFilter) => {
    setFilter(next);
    if (next === "week") setAnchor(today);
  };
  const toggleTag = (tag: string) =>
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const board = (
    <ReminderList
      items={items}
      all={all}
      filter={filter}
      anchor={anchor}
      todayKey={todayKey}
      hideCompleted={(filter === "week" || filter === "today") && hideCompleted}
      openId={selected?.id ?? null}
      readingId={readingId}
      scrollToId={scrollToId}
      draggable={!isMobile}
      active={active}
      mentionCandidates={mentionCandidates}
      onEditingChange={setEditingId}
      actions={actions}
    />
  );
  const heading =
    filter === "week" ? (
      <WeekNav
        anchor={anchor}
        isCurrentWeek={toDateKey(startOfWeek(anchor)) === toDateKey(startOfWeek(today))}
        onPrev={() => setAnchor((d) => addDays(d, -7))}
        onNext={() => setAnchor((d) => addDays(d, 7))}
        onCurrent={() => setAnchor(today)}
      />
    ) : (
      <h2 className="truncate text-title font-semibold">{t(($) => $.reminder[filter])}</h2>
    );
  const tools = (
    <div className="flex min-w-0 items-center gap-2">
      {activeTags.size > 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setActiveTags(new Set())}
          aria-label={t(($) => $.reminder.clear_tags)}
        >
          <X />
        </Button>
      )}
      {(filter === "week" || filter === "today") && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setHideCompleted((v) => !v)}
          aria-pressed={hideCompleted}
          aria-label={hideCompleted ? t(($) => $.reminder.show_completed) : t(($) => $.reminder.hide_completed)}
        >
          {hideCompleted ? <EyeOff /> : <Eye />}
        </Button>
      )}
      <TagStats stats={stats} active={activeTags} onToggle={toggleTag} />
    </div>
  );

  if (isMobile) {
    if (requestedId) {
      if (!selected) {
        return (
          <MobileLevel title="" backHref={paths.reminder()} backLabel={t(($) => $.reminder.back)}>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <ListTodo className="size-8" />
              {!list.isPending && <p className="text-body">{t(($) => $.reminder.not_found)}</p>}
            </div>
          </MobileLevel>
        );
      }
      const contact = parseContactParam(navigation.searchParams.get("contact"));
      if (contact) {
        return (
          <MobileContactDetail
            contact={contact}
            backHref={paths.reminderItem(selected.id)}
            backLabel={t(($) => $.panel.back)}
          />
        );
      }
      if (navigation.searchParams.get("view") === "progress") {
        return (
          <ChatProgressRoute
            chatId={selected.id}
            taskId={navigation.searchParams.get("task") ?? ""}
            backHref={paths.reminderItem(selected.id)}
          />
        );
      }
      return (
        <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
          <ChatThread
            key={selected.id}
            wsId={wsId}
            chat={selected}
            userId={userId}
            panelOpen={false}
            onTogglePanel={() => {}}
            mentionCandidates={mentionCandidates}
            focusComposer={composerFocusId === selected.id}
            mobileNav={{
              backHref: paths.reminder(),
              backLabel: t(($) => $.reminder.back),
              onOpenProfile: (type, id) => navigation.push(paths.reminderItemContact(selected.id, type, id)),
              onOpenProgress: (taskId) => navigation.push(paths.reminderItemProgress(selected.id, taskId)),
            }}
          />
        </div>
      );
    }
    return (
      <MobileTabScreen active="reminder">
        <div className="flex min-w-0 flex-1 flex-col">
          <FilterTabs filter={filter} onChange={chooseFilter} />
          <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">{heading}</div>
            </div>
            {tools}
          </div>
          {board}
        </div>
      </MobileTabScreen>
    );
  }

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      <ImRail active="reminder" />
      <ImSidebarShell>
        <ImSidebarHeader title={t(($) => $.reminder.title)}>
          <h1 className="min-w-0 flex-1 truncate px-1 text-body-lg font-semibold">{t(($) => $.reminder.title)}</h1>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void list.refetch()}
            disabled={list.isFetching}
            aria-label={t(($) => $.reminder.refresh)}
          >
            <RefreshCw className={cn(list.isFetching && "animate-spin")} />
          </Button>
        </ImSidebarHeader>
        <FilterList filter={filter} onChange={chooseFilter} />
      </ImSidebarShell>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-14 shrink-0 items-center gap-3 border-b px-6">
          <div className="absolute inset-0">
            <DragStrip />
          </div>
          <div
            className="relative flex min-w-0 flex-1 items-center justify-between gap-3"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
            <div className="flex min-w-0 shrink-0 items-center">{heading}</div>
            {tools}
          </div>
        </header>
        {list.isError ? (
          <p className="py-8 text-center text-body text-muted-foreground">{t(($) => $.reminder.load_failed)}</p>
        ) : (
          board
        )}
      </main>
      {selected ? (
        <ReminderThreadColumn
          wsId={wsId}
          reminder={selected}
          userId={userId}
          mentionCandidates={mentionCandidates}
          live={active}
          focusComposer={composerFocusId === selected.id}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

function FilterList({ filter, onChange }: { filter: ReminderFilter; onChange: (filter: ReminderFilter) => void }) {
  const { t } = useT("im");
  return (
    <nav aria-label={t(($) => $.reminder.filters)} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
      {FILTERS.map(({ id, icon: Icon, dot }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-current={filter === id ? "true" : undefined}
          className={cn(
            "flex h-9 items-center gap-3 rounded-lg px-3 text-left text-body transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            filter === id ? "bg-brand text-brand-foreground hover:bg-brand" : "text-foreground hover:bg-foreground/5",
          )}
        >
          <span className={cn("size-3 shrink-0 rounded-full", dot, filter === id && "ring-2 ring-brand-foreground/60")} />
          <Icon className="size-5 shrink-0" />
          <span className="flex-1 truncate">{t(($) => $.reminder[id])}</span>
        </button>
      ))}
    </nav>
  );
}

function FilterTabs({ filter, onChange }: { filter: ReminderFilter; onChange: (filter: ReminderFilter) => void }) {
  const { t } = useT("im");
  return (
    <nav aria-label={t(($) => $.reminder.filters)} className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2">
      {FILTERS.map(({ id }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-current={filter === id ? "true" : undefined}
          className={cn(
            "h-7 shrink-0 rounded-full px-3 text-label transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            filter === id ? "bg-brand font-medium text-brand-foreground" : "bg-foreground/5 text-muted-foreground",
          )}
        >
          {t(($) => $.reminder[id])}
        </button>
      ))}
    </nav>
  );
}

function WeekNav({
  anchor,
  isCurrentWeek,
  onPrev,
  onNext,
  onCurrent,
}: {
  anchor: Date;
  isCurrentWeek: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCurrent: () => void;
}) {
  const { t } = useT("im");
  return (
    <div className="flex min-w-0 items-center">
      <h2 className="min-w-[8.5rem] text-title font-semibold tabular-nums">{weekCode(anchor)}</h2>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={onPrev}
          aria-label={t(($) => $.reminder.prev_week)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={onNext}
          aria-label={t(($) => $.reminder.next_week)}
        >
          <ChevronRight />
        </Button>
        {!isCurrentWeek && (
          <Button variant="outline" size="sm" onClick={onCurrent}>
            {t(($) => $.reminder.current_week)}
          </Button>
        )}
      </div>
    </div>
  );
}

function TagStats({
  stats,
  active,
  onToggle,
}: {
  stats: TagStat[];
  active: ReadonlySet<string>;
  onToggle: (tag: string) => void;
}) {
  const { t } = useT("im");
  if (stats.length === 0) return null;
  return (
    <div role="group" aria-label={t(($) => $.reminder.tag_filters)} className="flex min-w-0 items-center gap-2 overflow-x-auto py-1">
      {stats.map(({ tag, total, completed }) => {
        const rate = total > 0 ? (completed / total) * 100 : 0;
        const on = active.has(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            aria-pressed={on}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              on ? "border-brand bg-brand/10" : "bg-background hover:bg-foreground/5",
            )}
          >
            <ProgressRing rate={rate} />
            <span className="flex flex-col items-start">
              <span className={cn("max-w-32 truncate text-micro font-medium", on ? "text-brand" : "text-foreground")}>
                #{tag}
              </span>
              <span className="text-micro text-muted-foreground tabular-nums">
                {completed}/{total}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProgressRing({ rate }: { rate: number }) {
  const size = 28;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone =
    rate === 100 ? "stroke-success" : rate >= 80 ? "stroke-info" : rate >= 50 ? "stroke-warning" : "stroke-destructive";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-muted" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - rate / 100)}
        className={tone}
      />
    </svg>
  );
}

/** The reminder's messages, sized and dragged like the chat details column. */
function ReminderThreadColumn({
  wsId,
  reminder,
  userId,
  mentionCandidates,
  live,
  focusComposer,
  onClose,
}: {
  wsId: string;
  reminder: Reminder;
  userId: string;
  mentionCandidates: ComposerMention[];
  live: boolean;
  focusComposer: boolean;
  onClose: () => void;
}) {
  const { t } = useT("im");
  const columnRef = useRef<HTMLDivElement>(null);
  const { width, commit, options } = useDetailsColumnWidth(columnRef);
  return (
    <div ref={columnRef} className="relative flex h-full shrink-0 flex-col border-l" style={{ width }}>
      <ChatThread
        key={reminder.id}
        wsId={wsId}
        chat={reminder}
        userId={userId}
        panelOpen={false}
        onTogglePanel={() => {}}
        mentionCandidates={mentionCandidates}
        live={live}
        focusComposer={focusComposer}
        onClose={onClose}
      />
      <ColumnResizeHandle edge="left" width={width} options={options} onCommit={commit} label={t(($) => $.reminder.resize)} />
    </div>
  );
}
