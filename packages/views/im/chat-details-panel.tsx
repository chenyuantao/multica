"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HardDrive, Minus, Pencil, Plus, Search } from "lucide-react";
import { directChatPeer, useRemoveGroupChatMember, useUpdateGroupChat } from "@multica/core/group-chats";
import { runtimeDisplayName, runtimeListOptions } from "@multica/core/runtimes";
import { useActorName } from "@multica/core/workspace/hooks";
import type { AgentRuntime, GroupChat, GroupChatMember } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { ActorAvatar } from "../common/actor-avatar";
import { ContentEditor } from "../editor";
import { useT } from "../i18n";
import { useOpenAgentDetail } from "../modals/agent-detail";
import { AddMemberDialog } from "./add-member-dialog";
import { CHAT_PANEL_WIDTH } from "./chat-panel-width";
import { ColumnResizeHandle, useColumnWidth } from "./resizable-column";
import { ChatDocumentsSection } from "./chat-documents-section";
import { ContactProfile } from "./contact-card";
import { useAgentClickActions } from "./use-agent-click-actions";
import { entryKey, useChatDirectory } from "./use-chat-directory";

interface ChatDetailsPanelProps {
  wsId: string;
  chat: GroupChat;
  userId: string;
  /** `page` fills the screen as the mobile settings level instead of a side column. */
  variant?: "aside" | "page";
  /** Opens a member's profile as a page level; without it agents open the detail modal. */
  onOpenMember?: (member: GroupChatMember) => void;
}

type Availability = "online" | "unstable" | "offline";

const EMPTY_RUNTIMES: AgentRuntime[] = [];

/**
 * Minimum slot for one avatar. Columns are `floor(width / 48)`, then the row
 * splits that width evenly — a 200px row holds four avatars.
 */
export const ROSTER_CELL_PX = 48;

export function rosterColumnCount(width: number, cellPx = ROSTER_CELL_PX): number {
  if (!Number.isFinite(width) || width < cellPx) return 1;
  return Math.floor(width / cellPx);
}

export function ChatDetailsPanel({ wsId, chat, userId, variant = "aside", onOpenMember }: ChatDetailsPanelProps) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const directory = useChatDirectory(wsId);
  const { agentList } = directory;
  const { data: runtimes = EMPTY_RUNTIMES } = useQuery(runtimeListOptions(wsId));
  const removeMember = useRemoveGroupChatMember(wsId, chat.id);
  const openAgentDetail = useOpenAgentDetail();
  const { width, commit, options } = useColumnWidth("details", CHAT_PANEL_WIDTH);

  const isCreator = chat.creator_type === "member" && chat.creator_id === userId;
  const agentMembers = chat.members.filter((m) => m.member_type === "agent");
  const agentClicks = useAgentClickActions(wsId, (agentId) => {
    const member = agentMembers.find((m) => m.member_id === agentId);
    if (onOpenMember && member) onOpenMember(member);
    else openAgentDetail(agentId);
  });
  const agentsById = useMemo(() => new Map(agentList.map((a) => [a.id, a])), [agentList]);
  const runtimesById = useMemo(() => new Map(runtimes.map((r) => [r.id, r])), [runtimes]);

  const runs = useMemo(() => {
    const groups = new Map<string, { name: string; availability: Availability; agentNames: string[] }>();
    for (const m of agentMembers) {
      const agent = agentsById.get(m.member_id);
      if (!agent?.runtime_id) continue;
      const runtime = runtimesById.get(agent.runtime_id);
      const entry = groups.get(agent.runtime_id) ?? {
        name: runtime ? runtimeDisplayName(runtime) : agent.runtime_id.slice(0, 8),
        availability: runtime?.status ?? agent.runtime_availability ?? "offline",
        agentNames: [],
      };
      entry.agentNames.push(agent.name);
      groups.set(agent.runtime_id, entry);
    }
    return [...groups.entries()];
  }, [agentMembers, agentsById, runtimesById]);

  const remove = async (m: GroupChatMember) => {
    try {
      await removeMember.mutateAsync({ memberType: m.member_type, memberId: m.member_id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.panel.remove_failed));
    }
  };

  const canRemove = (m: GroupChatMember) =>
    isCreator && !(m.member_type === "member" && m.member_id === chat.creator_id);

  const peer = directChatPeer(chat, userId);
  const asideClass = cn(
    "flex flex-col gap-5 overflow-y-auto bg-muted/40 px-4 pb-4",
    "pt-4",
    variant === "aside" ? "h-full w-full" : "min-h-0 w-full flex-1",
  );

  const panel = peer ? (
    <aside className={asideClass}>
      <ContactProfile
        entry={
          directory.byKey.get(entryKey(peer.member_type, peer.member_id)) ?? {
            type: peer.member_type,
            id: peer.member_id,
            name: getActorName(peer.member_type, peer.member_id),
            detail: "",
          }
        }
        userId={userId}
      />
      <ChatDocumentsSection wsId={wsId} chat={chat} />
    </aside>
  ) : (
    <aside className={asideClass}>
      <MemberRoster
        wsId={wsId}
        chat={chat}
        userId={userId}
        isCreator={isCreator}
        canRemove={canRemove}
        onRemove={(m) => void remove(m)}
        removeDisabled={removeMember.isPending}
        onOpenMember={onOpenMember}
        onOpenAgent={(id) => agentClicks.open(id)}
        onChatAgent={(id) => agentClicks.chat(id)}
      />

      <PanelSection title={t(($) => $.panel.name)}>
        <ChatNameRow wsId={wsId} chat={chat} />
      </PanelSection>

      <PanelSection title={t(($) => $.panel.announcement)}>
        <ChatAnnouncement wsId={wsId} chat={chat} />
      </PanelSection>

      <ChatDocumentsSection wsId={wsId} chat={chat} />

      {runs.length > 0 && (
        <PanelSection title={t(($) => $.panel.runs)}>
          {runs.map(([id, run]) => (
            <div key={id} className="flex items-center gap-3 px-3 py-2">
              <HardDrive className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{run.name}</span>
                <span className="block truncate text-caption text-muted-foreground">{run.agentNames.join(", ")}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-caption font-medium",
                  run.availability === "online" && "text-success",
                  run.availability === "unstable" && "text-warning",
                  run.availability === "offline" && "text-muted-foreground",
                )}
              >
                {t(($) => $.panel[run.availability])}
              </span>
            </div>
          ))}
        </PanelSection>
      )}
    </aside>
  );

  if (variant === "page") return panel;
  return (
    <div className="relative h-full shrink-0 border-l" style={{ width }}>
      {panel}
      <ColumnResizeHandle
        edge="left"
        width={width}
        options={options}
        onCommit={commit}
        label={t(($) => $.panel.resize)}
      />
    </div>
  );
}

function ChatAnnouncement({ wsId, chat }: { wsId: string; chat: GroupChat }) {
  const { t } = useT("im");
  const update = useUpdateGroupChat(wsId, chat.id);

  const save = async (description: string) => {
    try {
      await update.mutateAsync({ description });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.panel.announcement_failed));
    }
  };

  return (
    <div className="px-3 py-2">
      <ContentEditor
        key={chat.id}
        value={chat.description}
        placeholder={t(($) => $.panel.announcement_placeholder)}
        onUpdate={(md) => void save(md)}
        debounceMs={1500}
        flushPendingOnUnmount
        className="min-h-12"
      />
    </div>
  );
}

function ChatNameRow({ wsId, chat }: { wsId: string; chat: GroupChat }) {
  const { t } = useT("im");
  const rename = useUpdateGroupChat(wsId, chat.id);
  const [draft, setDraft] = useState<string | null>(null);

  const save = async () => {
    if (draft === null) return;
    const title = draft.trim();
    if (!title || title === chat.title) {
      setDraft(null);
      return;
    }
    try {
      await rename.mutateAsync({ title });
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.panel.rename_failed));
    }
  };

  if (draft !== null) {
    return (
      <div className="px-2 py-1.5">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(null);
            }
          }}
          disabled={rename.isPending}
          aria-label={t(($) => $.panel.name)}
          className="h-8"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-body font-medium">{chat.title}</span>
      <Button variant="ghost" size="icon-xs" onClick={() => setDraft(chat.title)} aria-label={t(($) => $.panel.rename)}>
        <Pencil className="text-muted-foreground" />
      </Button>
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-micro font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="divide-y overflow-hidden rounded-xl border bg-background">{children}</div>
    </section>
  );
}

function useRosterColumns(cellPx: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (width: number) => {
      const next = rosterColumnCount(width, cellPx);
      setColumns((current) => (current === next ? current : next));
    };
    apply(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cellPx]);

  return { ref, columns };
}

function MemberRoster({
  wsId,
  chat,
  userId,
  isCreator,
  canRemove,
  onRemove,
  removeDisabled,
  onOpenMember,
  onOpenAgent,
  onChatAgent,
}: {
  wsId: string;
  chat: GroupChat;
  userId: string;
  isCreator: boolean;
  canRemove: (member: GroupChatMember) => boolean;
  onRemove: (member: GroupChatMember) => void;
  removeDisabled: boolean;
  onOpenMember?: (member: GroupChatMember) => void;
  onOpenAgent: (agentId: string) => void;
  onChatAgent: (agentId: string) => void;
}) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { ref, columns } = useRosterColumns(ROSTER_CELL_PX);
  const filtering = query.trim().length > 0;
  const hasRemovable = chat.members.some(canRemove);
  const visible = chat.members.filter((member) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return getActorName(member.member_type, member.member_id).toLowerCase().includes(q);
  });

  useEffect(() => {
    if (!hasRemovable) setRemoving(false);
  }, [hasRemovable]);

  const removeMode = removing && !filtering;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(($) => $.panel.search)}
          aria-label={t(($) => $.panel.search)}
          className="rounded-full bg-background pl-8"
        />
      </div>
      {filtering && visible.length === 0 ? (
        <p className="px-1 py-3 text-center text-caption text-muted-foreground">{t(($) => $.panel.no_matches)}</p>
      ) : (
        <div
          ref={ref}
          role="group"
          aria-label={t(($) => $.panel.roster)}
          className="grid min-w-0 gap-y-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {visible.map((member) => {
            const name = getActorName(member.member_type, member.member_id);
            const detail = [
              member.member_type === "member" && member.member_id === chat.creator_id ? t(($) => $.panel.creator) : null,
              member.member_id === userId ? t(($) => $.panel.you) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <MemberTile
                key={`${member.member_type}:${member.member_id}`}
                member={member}
                name={name}
                detail={detail}
                removing={removeMode && canRemove(member)}
                removeLabel={t(($) => $.panel.remove, { name })}
                removeDisabled={removeDisabled}
                onRemove={() => onRemove(member)}
                onOpen={
                  member.member_type === "agent"
                    ? () => onOpenAgent(member.member_id)
                    : onOpenMember
                      ? () => onOpenMember(member)
                      : undefined
                }
                onDoubleOpen={member.member_type === "agent" ? () => onChatAgent(member.member_id) : undefined}
              />
            );
          })}
          {isCreator && !filtering && (
            <RosterAction label={t(($) => $.panel.add)} ariaLabel={t(($) => $.panel.add_member)} onClick={() => setAddOpen(true)}>
              <Plus className="size-5" />
            </RosterAction>
          )}
          {isCreator && !filtering && hasRemovable && (
            <RosterAction
              label={t(($) => $.panel.remove_members)}
              pressed={removeMode}
              onClick={() => setRemoving((current) => !current)}
            >
              <Minus className="size-5" />
            </RosterAction>
          )}
        </div>
      )}
      {isCreator && <AddMemberDialog wsId={wsId} chat={chat} open={addOpen} onOpenChange={setAddOpen} />}
    </div>
  );
}

function MemberTile({
  member,
  name,
  detail,
  removing,
  removeLabel,
  removeDisabled,
  onRemove,
  onOpen,
  onDoubleOpen,
}: {
  member: GroupChatMember;
  name: string;
  detail: string;
  removing: boolean;
  removeLabel: string;
  removeDisabled: boolean;
  onRemove: () => void;
  onOpen?: () => void;
  onDoubleOpen?: () => void;
}) {
  const activate = () => {
    if (removing) {
      onRemove();
      return;
    }
    onOpen?.();
  };
  const interactive = removing || !!onOpen;
  const caption = (
    <span className="w-full truncate text-center text-caption text-muted-foreground">{name}</span>
  );

  return (
    <div className="flex min-w-0 flex-col items-center gap-1" title={detail ? `${name} · ${detail}` : name}>
      <span className="relative inline-flex" onDoubleClick={removing ? undefined : onDoubleOpen}>
        <ActorAvatar
          actorType={member.member_type}
          actorId={member.member_id}
          size={ROSTER_CELL_PX}
          enableHoverCard
          showStatusDot={member.member_type === "agent"}
          onOpenProfile={interactive ? activate : undefined}
        />
        {removing && (
          <button
            type="button"
            aria-label={removeLabel}
            disabled={removeDisabled}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="absolute -top-1 -left-1 z-10 flex size-4 items-center justify-center rounded-full bg-destructive text-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            <Minus className="size-3" />
          </button>
        )}
      </span>
      {interactive ? (
        <button
          type="button"
          onClick={activate}
          onDoubleClick={removing ? undefined : onDoubleOpen}
          className={cn(
            "w-full min-w-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            onDoubleOpen && !removing && "select-none",
          )}
        >
          {caption}
        </button>
      ) : (
        caption
      )}
    </div>
  );
}

function RosterAction({
  label,
  ariaLabel,
  pressed,
  onClick,
  children,
}: {
  label: string;
  ariaLabel?: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex min-w-0 flex-col items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-avatar border border-dashed text-muted-foreground",
          pressed ? "border-foreground bg-background text-foreground" : "border-border",
        )}
        style={{ width: ROSTER_CELL_PX, height: ROSTER_CELL_PX }}
      >
        {children}
      </span>
      <span className="w-full truncate text-center text-caption text-muted-foreground">{label}</span>
    </button>
  );
}
