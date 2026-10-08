"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Loader2, Pin, Plus, Trash2 } from "lucide-react";
import type { Reminder, ReminderPatch } from "@multica/core/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@multica/ui/components/ui/context-menu";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { useT } from "../i18n";
import { RichContent } from "../rich-content";
import { decodeMentionDraft, resolveTitleMentions, type ComposerMention } from "./im-utils";
import { ReminderTitleField } from "./reminder-title-field";
import {
  dayGroups,
  dropPosition,
  dueKey,
  endPosition,
  isDone,
  moveTargets,
  pinnedReminders,
  reminderTags,
  type DayGroup,
  type ReminderFilter,
} from "./reminder-board";
import { shortDate, weekdayIndex } from "./reminder-dates";
import { UnreadBadge } from "./unread-badge";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_PREFIX = "day:";
const dayContainer = (key: string) => `${DAY_PREFIX}${key}`;

export interface ReminderListActions {
  open: (id: string) => void;
  update: (updates: { id: string; patch: ReminderPatch }[]) => void;
  remove: (ids: string[]) => void;
  setPending: (ids: string[], pending: boolean) => void;
  /** Resolves true once the reminder exists. */
  create: (title: string, dueKey: string, position: number) => Promise<boolean>;
}

type Editing = { kind: "row"; id: string } | { kind: "draft"; key: string } | null;

interface ReminderListProps {
  /** The view's reminders after tag filtering. */
  items: Reminder[];
  /** Every reminder, for placing added and moved ones after a day's others. */
  all: Reminder[];
  filter: ReminderFilter;
  anchor: Date;
  todayKey: string;
  hideCompleted: boolean;
  openId: string | null;
  /** Rows reorder and change day by dragging; off on phones, where a long press opens the menu. */
  draggable: boolean;
  /** Agents a title can @. Naming one in the title assigns the reminder. */
  mentionCandidates: ComposerMention[];
  onEditingChange: (id: string | null) => void;
  actions: ReminderListActions;
}

/**
 * The reminder days. A click opens the reminder's messages, Shift/Ctrl/Cmd
 * click adds to the selection, a double click renames, the context menu
 * moves, pins, or deletes the selection, and dragging reorders or moves a
 * reminder to another day.
 */
export function ReminderList({
  items,
  all,
  filter,
  anchor,
  todayKey,
  hideCompleted,
  openId,
  draggable,
  mentionCandidates,
  onEditingChange,
  actions,
}: ReminderListProps) {
  const { t } = useT("im");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditingState] = useState<Editing>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ComposerMention[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editGen = useRef(0);
  const committing = useRef(false);
  /** Enter commits and then blur commits again as the field unmounts. */
  const commitLock = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragContainers, setDragContainers] = useState<Record<string, string[]> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    () => dayGroups(items, filter, anchor, todayKey, hideCompleted),
    [items, filter, anchor, todayKey, hideCompleted],
  );
  const pinned = useMemo(() => pinnedReminders(items), [items]);
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const baseContainers = useMemo(
    () => Object.fromEntries(groups.map((g) => [dayContainer(g.key), g.items.map((r) => r.id)])),
    [groups],
  );
  const containers = dragContainers ?? baseContainers;

  // A drop keeps its preview until the moved row lands in the data.
  useEffect(() => {
    if (!activeId) setDragContainers(null);
  }, [baseContainers, activeId]);

  const setEditing = (next: Editing, initial = "", nextPicked: ComposerMention[] = []) => {
    editGen.current += 1;
    setEditingState(next);
    setText(initial);
    setPicked(nextPicked);
    setNameError(null);
    onEditingChange(next?.kind === "row" ? next.id : null);
  };

  /** Markdown title, "" when the field is empty, or null when a shared name must be picked. */
  const resolveCurrent = (): string | null => {
    const title = text.trim();
    if (!title) return "";
    const resolved = resolveTitleMentions(title, picked, mentionCandidates);
    if (!resolved.ok) {
      setNameError(resolved.name);
      return null;
    }
    setNameError(null);
    return resolved.markdown;
  };

  const applyTitle = (title: string) => {
    if (editing?.kind === "row") {
      const r = byId.get(editing.id);
      if (r && !title) actions.remove([r.id]);
      else if (r && title !== r.title) actions.update([{ id: r.id, patch: { title } }]);
      return;
    }
    if (editing?.kind === "draft" && title && !saving && !committing.current) {
      committing.current = true;
      setSaving(true);
      const gen = editGen.current;
      void actions.create(title, editing.key, endPosition(all, editing.key)).then((created) => {
        committing.current = false;
        setSaving(false);
        if (created && editGen.current === gen) setEditing(null);
        else commitLock.current = false;
      });
    }
  };

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
    };
    const onClick = (e: globalThis.MouseEvent) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.("[data-reminder-row], [role='menu']")) return;
      setSelected(new Set());
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    commitLock.current = false;
  }, [editing]);

  const anchorKey = anchor.toDateString();
  useEffect(() => {
    if (filter !== "week") return;
    scrollRef.current?.querySelector(`[data-day="${todayKey}"]`)?.scrollIntoView?.({ block: "start" });
  }, [filter, anchorKey, todayKey]);

  /** Saves what is being typed before another edit starts. False when the title cannot be saved yet. */
  const flushEditing = () => {
    if (!editing) return true;
    if (commitLock.current || committing.current) return true;
    const title = resolveCurrent();
    if (title === null) return false;
    commitLock.current = true;
    applyTitle(title);
    return true;
  };

  const commit = () => {
    if (commitLock.current || !editing || committing.current) return;
    const title = resolveCurrent();
    if (title === null) return;
    commitLock.current = true;
    if (!title && editing.kind === "draft") {
      setEditing(null);
      return;
    }
    applyTitle(title);
    if (editing.kind === "row") setEditing(null);
  };

  const startDraft = (key: string, initial = "") => {
    if (!flushEditing()) return;
    setEditing({ kind: "draft", key }, initial);
  };

  const startRename = (r: Reminder) => {
    if (editing?.kind === "row" && editing.id === r.id) return;
    if (!flushEditing()) return;
    const draft = decodeMentionDraft(r.title);
    setEditing({ kind: "row", id: r.id }, draft.text, draft.picked);
  };

  const clickRow = (id: string, e: MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      if (editing) setEditing(null);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelected(new Set([id]));
    actions.open(id);
  };

  const targetsFor = (id: string) => (selected.has(id) ? [...selected] : [id]);
  const moveTo = (id: string, key: string) => {
    const ids = targetsFor(id);
    const start = endPosition(all, key, new Set(ids));
    actions.update(ids.map((x, i) => ({ id: x, patch: { due_date: key, position: start + i } })));
  };
  const targets = moveTargets(new Date());

  const menuFor = (r: Reminder) => (
    <>
      <ContextMenuItem onClick={() => moveTo(r.id, targets.today)}>{t(($) => $.reminder.move_today)}</ContextMenuItem>
      <ContextMenuItem onClick={() => moveTo(r.id, targets.tomorrow)}>{t(($) => $.reminder.move_tomorrow)}</ContextMenuItem>
      <ContextMenuItem onClick={() => moveTo(r.id, targets.friday)}>{t(($) => $.reminder.move_friday)}</ContextMenuItem>
      <ContextMenuItem onClick={() => moveTo(r.id, targets.nextMonday)}>
        {t(($) => $.reminder.move_next_monday)}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => actions.setPending(targetsFor(r.id), !r.pending)}>
        {r.pending ? t(($) => $.reminder.unpin) : t(($) => $.reminder.pin)}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onClick={() => {
          actions.remove(targetsFor(r.id));
          setSelected(new Set());
        }}
      >
        {t(($) => $.reminder.delete_action)}
      </ContextMenuItem>
    </>
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 100, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canDrag = draggable && editing === null;
  const containerOf = (map: Record<string, string[]>, id: string) =>
    id.startsWith(DAY_PREFIX) ? id : Object.keys(map).find((c) => map[c]!.includes(id)) ?? null;

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setDragContainers(baseContainers);
  };
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    setDragContainers((prev) => {
      const map = prev ?? baseContainers;
      const from = containerOf(map, id);
      const to = containerOf(map, overId);
      if (!from || !to) return map;
      if (from === to) {
        const list = map[from]!;
        const a = list.indexOf(id);
        const b = list.indexOf(overId);
        if (a === -1 || b === -1 || a === b) return map;
        return { ...map, [from]: arrayMove(list, a, b) };
      }
      const source = map[from]!.filter((x) => x !== id);
      const dest = [...(map[to] ?? [])];
      const at = dest.indexOf(overId);
      dest.splice(at === -1 ? dest.length : at, 0, id);
      return { ...map, [from]: source, [to]: dest };
    });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const map = dragContainers ?? baseContainers;
    const to = containerOf(map, id);
    const r = byId.get(id);
    setActiveId(null);
    if (!over || !to || !r) {
      setDragContainers(null);
      return;
    }
    const key = to.slice(DAY_PREFIX.length);
    const order = map[to]!;
    const sameDay = dueKey(r) === key;
    if (sameDay && order.join() === (baseContainers[to] ?? []).join()) {
      setDragContainers(null);
      return;
    }
    const patch: ReminderPatch = { position: dropPosition(order, id, byId) };
    if (!sameDay) patch.due_date = key;
    actions.update([{ id, patch }]);
  };

  const dayLabel = (key: string) => {
    if (key === todayKey) return t(($) => $.reminder.today);
    if (filter === "week" || filter === "today") {
      return t(($) => $.reminder.day_label, {
        weekday: t(($) => $.reminder.weekdays[WEEKDAYS[weekdayIndex(key)]!]),
        date: shortDate(key),
      });
    }
    return shortDate(key);
  };

  const row = (r: Reminder, opts: { sortable: boolean; divider: boolean }) => {
    const isEditing = editing?.kind === "row" && editing.id === r.id;
    return (
      <ReminderRow
        key={r.id}
        reminder={r}
        sortable={opts.sortable && canDrag}
        divider={opts.divider}
        hidden={activeId === r.id}
        selected={selected.has(r.id) || r.id === openId}
        current={r.id === openId}
        editing={isEditing}
        editor={
          isEditing ? (
            <ReminderTitleField
              value={text}
              onChange={(next) => {
                setNameError(null);
                setText(next);
              }}
              picked={picked}
              onPickedChange={setPicked}
              candidates={mentionCandidates}
              errorName={nameError}
              onCommit={commit}
              onCancel={() => setEditing(null)}
              ariaLabel={t(($) => $.reminder.title_field)}
            />
          ) : null
        }
        menu={menuFor(r)}
        onMenuOpen={() => {
          if (!selected.has(r.id)) setSelected(new Set([r.id]));
        }}
        onClick={(e) => clickRow(r.id, e)}
        onRename={() => startRename(r)}
        onToggle={() => actions.update([{ id: r.id, patch: { done: !isDone(r) } }])}
        onDelete={() => actions.remove([r.id])}
        onTag={(tag) => startDraft(dueKey(r) ?? todayKey, `#${tag} `)}
      />
    );
  };

  const draftRow = (
    <div className="ml-2 flex items-center gap-3 rounded-lg bg-brand/8 p-1 ring-1 ring-brand/30">
      <span className="size-5 shrink-0 rounded-full border-2 border-border" />
      <ReminderTitleField
        value={text}
        onChange={(next) => {
          setNameError(null);
          setText(next);
        }}
        picked={picked}
        onPickedChange={setPicked}
        candidates={mentionCandidates}
        errorName={nameError}
        onCommit={commit}
        onCancel={() => setEditing(null)}
        disabled={saving}
        placeholder={t(($) => $.reminder.add_placeholder)}
        ariaLabel={t(($) => $.reminder.title_field)}
      />
      {saving && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );

  const activeReminder = activeId ? byId.get(activeId) : undefined;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {pinned.length > 0 ? (
        <section
          aria-label={t(($) => $.reminder.pending)}
          className="sticky top-0 z-10 -mx-4 mb-3 border-b border-warning/40 bg-background px-4 pt-4 pb-3"
        >
          <h3 className="mb-1 flex items-center gap-2 px-2 py-1 text-label font-medium text-warning">
            <Pin className="size-4" />
            {t(($) => $.reminder.pending)}
          </h3>
          <ul className="ml-2 space-y-1">
            {pinned.map((r, i) => row(r, { sortable: false, divider: i < pinned.length - 1 }))}
          </ul>
        </section>
      ) : (
        <div className="h-4" />
      )}
      {groups.length === 0 && pinned.length === 0 ? (
        <p className="py-8 text-center text-body text-muted-foreground">{t(($) => $.reminder.empty)}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDragContainers(null);
          }}
        >
          <div className="space-y-3">
            {groups.map((group, index) => {
              const ids = containers[dayContainer(group.key)] ?? [];
              const rows = ids.map((id) => byId.get(id)).filter((r): r is Reminder => !!r);
              const isToday = group.key === todayKey;
              return (
                <div key={group.key} data-day={group.key}>
                  <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    <DaySection
                      group={group}
                      label={dayLabel(group.key)}
                      isToday={isToday}
                      count={rows.length}
                      addable={(rows.length > 0 || isToday) && group.key >= todayKey}
                      drafting={editing?.kind === "draft" && editing.key === group.key}
                      draft={draftRow}
                      onAdd={() => startDraft(group.key)}
                    >
                      {rows.map((r, i) => row(r, { sortable: true, divider: i < rows.length - 1 }))}
                    </DaySection>
                  </SortableContext>
                  {index < groups.length - 1 && <div className="my-2 h-px bg-border" />}
                </div>
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeReminder ? (
              <div className="rounded-lg border bg-popover p-3 text-body break-words shadow-xl">
                {decodeMentionDraft(activeReminder.title).text}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function DaySection({
  group,
  label,
  isToday,
  count,
  addable,
  drafting,
  draft,
  onAdd,
  children,
}: {
  group: DayGroup;
  label: string;
  isToday: boolean;
  count: number;
  addable: boolean;
  drafting: boolean;
  draft: ReactNode;
  onAdd: () => void;
  children: ReactNode;
}) {
  const { t } = useT("im");
  const { setNodeRef } = useDroppable({ id: dayContainer(group.key) });
  return (
    <section ref={setNodeRef} aria-label={label} className="space-y-2">
      <h3>
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className={isToday ? "text-title-sm font-semibold" : "text-label text-muted-foreground"}>{label}</span>
          {group.hiddenDone > 0 && (
            <span
              aria-label={t(($) => $.reminder.completed_count, { count: group.hiddenDone })}
              className="flex items-center gap-0.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-micro text-success"
            >
              <Check className="size-3" />
              {group.hiddenDone}
            </span>
          )}
        </button>
      </h3>
      {count > 0 && <ul className="ml-2 space-y-1">{children}</ul>}
      {drafting
        ? draft
        : addable && (
            <button
              type="button"
              onClick={onAdd}
              className={cn(
                "flex w-full items-center justify-center gap-1 p-2 text-label transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                count > 0
                  ? "text-muted-foreground hover:text-foreground"
                  : "rounded-lg border-2 border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              <Plus className="size-4" />
              {count > 0 ? t(($) => $.reminder.add_more) : t(($) => $.reminder.add_first)}
            </button>
          )}
    </section>
  );
}

function ReminderRow({
  reminder,
  sortable,
  divider,
  hidden,
  selected,
  current,
  editing,
  editor,
  menu,
  onMenuOpen,
  onClick,
  onRename,
  onToggle,
  onDelete,
  onTag,
}: {
  reminder: Reminder;
  sortable: boolean;
  divider: boolean;
  hidden: boolean;
  selected: boolean;
  current: boolean;
  editing: boolean;
  editor: ReactNode;
  menu: ReactNode;
  onMenuOpen: () => void;
  onClick: (e: MouseEvent) => void;
  onRename: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onTag: (tag: string) => void;
}) {
  const { t } = useT("im");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({
    id: reminder.id,
    disabled: !sortable,
  });
  const { role: _role, ...dragAttributes } = attributes;
  const done = isDone(reminder);
  const tags = reminderTags(reminder.title);
  const titleLabel = decodeMentionDraft(reminder.title).text;
  const agents = reminder.members.filter((m) => m.member_type === "agent");

  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        setActivatorNodeRef(el);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition, visibility: hidden ? "hidden" : undefined }}
      data-reminder-row
      {...(sortable ? { ...dragAttributes, ...listeners } : {})}
      className="group/row outline-none"
    >
      <ContextMenu onOpenChange={(open) => open && onMenuOpen()}>
        <ContextMenuTrigger
          className={cn(
            "relative flex items-center gap-3 rounded-lg p-1 transition-colors [-webkit-touch-callout:none]",
            done && !editing && "opacity-60",
            editing
              ? "bg-brand/8 ring-1 ring-brand/30"
              : selected
                ? "bg-brand/12 hover:bg-brand/12"
                : "hover:bg-foreground/5",
          )}
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            onClick={onToggle}
            aria-label={
              done
                ? t(($) => $.reminder.mark_open, { title: titleLabel })
                : t(($) => $.reminder.mark_done, { title: titleLabel })
            }
            className={cn(
              "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              done ? "border-brand bg-brand text-brand-foreground" : "border-border hover:border-brand",
            )}
          >
            {done && <Check className="size-3" strokeWidth={3} />}
          </button>
          {editing ? (
            editor
          ) : (
            <>
              <button
                type="button"
                onClick={onClick}
                onDoubleClick={onRename}
                aria-current={current ? "true" : undefined}
                aria-label={titleLabel}
                className="absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              />
              <div className="pointer-events-none relative min-w-0 flex-1 transition-colors group-hover/row:text-brand [&_a]:pointer-events-auto">
                <div className={cn("text-body break-words", done && "text-muted-foreground line-through")}>
                  <RichContent content={reminder.title} density="compact" />
                </div>
                {tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTag(tag);
                        }}
                        className="pointer-events-auto rounded-full bg-muted px-2 py-0.5 text-caption text-brand transition-colors hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="pointer-events-none relative flex shrink-0 items-center gap-1.5">
                {reminder.pending_speakers.length > 0 && (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )}
                {agents.length > 0 && (
                  <span className="flex -space-x-1.5">
                    {agents.slice(0, 3).map((m) => (
                      <ActorAvatar key={m.member_id} actorType="agent" actorId={m.member_id} size={18} profileLink={false} />
                    ))}
                  </span>
                )}
                <UnreadBadge
                  count={reminder.unread_count}
                  label={t(($) => $.sidebar.unread, { count: reminder.unread_count })}
                />
              </div>
              <button
                type="button"
                onClick={onDelete}
                aria-label={t(($) => $.reminder.delete, { title: titleLabel })}
                className="relative z-10 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>{menu}</ContextMenuContent>
      </ContextMenu>
      {divider && <div aria-hidden className="mx-5 my-1 h-px bg-border" />}
    </li>
  );
}
