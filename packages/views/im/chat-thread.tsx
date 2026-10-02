"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Brain, Check, Copy, Forward, Info, ListChecks, Loader2, MoreHorizontal, PanelRight, Quote, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { configuredConversationStarters } from "@multica/core/agents";
import { useTaskMessages } from "@multica/core/chat/queries";
import {
  directChatPeer,
  groupChatListOptions,
  groupChatMessagesOptions,
  useDeleteGroupChatMessage,
  useForwardChatHistory,
  useMarkGroupChatRead,
  useSendGroupChatMessage,
} from "@multica/core/group-chats";
import { useCancelIssueRun } from "@multica/core/issues/mutations";
import { issueTasksOptions } from "@multica/core/issues/queries";
import { useCurrentMember } from "@multica/core/permissions";
import { useActorName } from "@multica/core/workspace/hooks";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent, AgentTask, AskAISelection, Comment, FocusNote, GroupChat } from "@multica/core/types";
import { copyText } from "@multica/ui/lib/clipboard";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@multica/ui/components/ui/context-menu";
import { ConversationStarterChips } from "../chat/components/conversation-starter-list";
import { AgentTranscriptDialog } from "../common/task-transcript/agent-transcript-dialog";
import { buildTimeline } from "../common/task-transcript/build-timeline";
import { ActorAvatar } from "../common/actor-avatar";
import { useAppForeground } from "../common/use-app-foreground";
import { RichContent } from "../rich-content";
import { useT } from "../i18n";
import { useOpenAgentDetail } from "../modals/agent-detail";
import { AppLink } from "../navigation";
import { DragStrip } from "../platform";
import { AskAIBadge } from "./ask-ai-badge";
import { parseCancelledNotice, type CancelledNoticeData } from "./cancelled-notice";
import { JsonViewer } from "../common/json-viewer";
import { highlightedTextWithin } from "./ask-ai-context";
import { ChatComposer, QuoteText, type ComposerQuote } from "./chat-composer";
import {
  CHAT_HISTORY_MAX_BYTES,
  canForwardMessage,
  encodeChatHistory,
  historyContentOf,
  isChatHistoryContent,
  utf8Size,
} from "./chat-history";
import { ChatHistoryCard } from "./chat-history-card";
import { ForwardDialog } from "./forward-dialog";
import { MobileLevelHeader } from "./mobile-shell";
import { useAgentClickActions, type AgentClickActions } from "./use-agent-click-actions";
import {
  THINKING_MESSAGE,
  chatDisplayTitle,
  encodeMentions,
  formatClock,
  formatStamp,
  isSameDay,
  needsTimeSeparator,
  plainTextPreview,
  runProgress,
  thinkingTaskId,
  type ComposerMention,
} from "./im-utils";

interface PendingMessage {
  localId: string;
  content: string;
  attachmentIds: string[];
  refMessageId?: string;
  focusNote?: FocusNote;
  status: "sending" | "failed";
  /** Message ids already in the thread when this was queued; the echo is a new id. */
  knownIds: Set<string>;
}

interface ChatThreadProps {
  wsId: string;
  chat: GroupChat;
  userId: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** Opens Ask AI from the header, or about one message from its menu. */
  onAskAI?: (selection?: AskAISelection) => void;
  /** The knowledge note tab open beside the chat. Each send tells the agent the message is about it. */
  focusNote?: FocusNote | null;
  /** Mobile stacked layout: back to the chat list, on to chat settings, and profiles as page levels. */
  mobileNav?: {
    backHref: string;
    settingsHref: string;
    onOpenProfile: (actorType: string, actorId: string) => void;
    /** Opens a forwarded history card as its own page. */
    onOpenHistory?: (messageId: string) => void;
    /** Opens the thinking bubble's run as its own page. */
    onOpenProgress?: (taskId: string) => void;
  };
}

const EMPTY_COMMENTS: Comment[] = [];
const EMPTY_AGENTS: Agent[] = [];
const EMPTY_CHATS: GroupChat[] = [];

function asGroupChats(data: unknown): GroupChat[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is GroupChat =>
      !!item &&
      typeof item === "object" &&
      "id" in item &&
      "title" in item &&
      "members" in item &&
      "pinned" in item &&
      "is_direct" in item &&
      "created_at" in item,
  );
}

export function ChatThread({ wsId, chat, userId, panelOpen, onTogglePanel, onAskAI, focusNote, mobileNav }: ChatThreadProps) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const { data = EMPTY_COMMENTS, isError } = useQuery(groupChatMessagesOptions(wsId, chat.id));
  const { data: agentList = EMPTY_AGENTS } = useQuery(agentListOptions(wsId));
  const send = useSendGroupChatMessage(wsId, chat.id);
  const forward = useForwardChatHistory(wsId);
  const remove = useDeleteGroupChatMessage(wsId, chat.id);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Comment | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const chatList = useQuery({ ...groupChatListOptions(wsId), enabled: forwardIds !== null });
  const { role } = useCurrentMember(wsId);
  const isAdmin = role === "owner" || role === "admin";
  const scrollRef = useRef<HTMLDivElement>(null);
  const openAgentDetail = useOpenAgentDetail();
  const agentClicks = useAgentClickActions(
    wsId,
    mobileNav ? (agentId) => mobileNav.onOpenProfile("agent", agentId) : openAgentDetail,
  );

  useEffect(() => {
    setPending([]);
    setQuoteId(null);
    setSelecting(false);
    setSelected(new Set());
    setForwardIds(null);
  }, [chat.id]);

  // An open chat reads everything that lands in it while the app is in front.
  // Messages that arrive while it is backgrounded stay unread until the user
  // returns. Each unread state is tried once, so a failing request is not
  // retried in a loop; the next message tries again.
  const foreground = useAppForeground();
  const { mutate: markRead } = useMarkGroupChatRead(wsId, chat.id);
  const unread = chat.unread_count;
  const readKey = `${chat.last_comment_at ?? ""}:${unread}`;
  const attemptedReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!foreground || unread <= 0 || attemptedReadRef.current === readKey) return;
    const timer = setTimeout(() => {
      attemptedReadRef.current = readKey;
      markRead();
    }, 0);
    return () => clearTimeout(timer);
  }, [foreground, unread, readKey, markRead]);

  const messages = useMemo(
    () =>
      data
        .filter((c) => !c.deleted_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
    [data],
  );
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  /** The quoted message as one line; null once it has been deleted. */
  const quoteOf = useCallback(
    (id: string): ComposerQuote | null => {
      const m = byId.get(id);
      if (!m) return null;
      const text = isChatHistoryContent(m.content)
        ? t(($) => $.thread.history_footer)
        : parseCancelledNotice(m.content)
          ? t(($) => $.thread.cancelled_in_progress)
          : plainTextPreview(m.content) || t(($) => $.thread.quote_attachment);
      return { id, name: getActorName(m.author_type, m.author_id), text };
    },
    [byId, getActorName, t],
  );
  const composerQuote = quoteId ? quoteOf(quoteId) : null;

  const jumpTo = useCallback((id: string) => {
    scrollRef.current?.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const copyMessage = useCallback(
    async (m: Comment) => {
      if (await copyText(m.content)) toast.success(t(($) => $.thread.copied));
      else toast.error(t(($) => $.thread.copy_failed));
    },
    [t],
  );

  const actionsFor = (m: Comment): MessageActions => {
    const mine = m.author_type === "member" && m.author_id === userId;
    return {
      onCopy: () => void copyMessage(m),
      onQuote: () => setQuoteId(m.id),
      canForward: canForwardMessage(m),
      onForward: () => {
        if (!canForwardMessage(m)) return;
        setForwardIds([m.id]);
      },
      onMultiSelect: () => {
        if (!canForwardMessage(m)) return;
        setSelecting(true);
        setSelected(new Set([m.id]));
      },
      onDelete: mine || isAdmin ? () => setDeleting(m) : undefined,
      onAskAI: onAskAI
        ? (text) =>
            onAskAI({
              message_id: m.id,
              time: m.created_at,
              sender: getActorName(m.author_type, m.author_id),
              content: m.content,
              ...(text ? { text } : {}),
            })
        : undefined,
    };
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        if (quoteId === deleting.id) setQuoteId(null);
        setDeleting(null);
      },
      onError: () => toast.error(t(($) => $.thread.delete_failed)),
    });
  };

  // The realtime refetch can deliver the stored message before the send request
  // resolves; hide each in-flight entry once its echo is in the thread.
  const visiblePending = useMemo(() => {
    const claimed = new Set<string>();
    return pending.filter((p) => {
      if (p.status !== "sending") return true;
      const echo = messages.find(
        (m) =>
          m.author_type === "member" &&
          m.author_id === userId &&
          m.content === p.content &&
          !p.knownIds.has(m.id) &&
          !claimed.has(m.id),
      );
      if (!echo) return true;
      claimed.add(echo.id);
      return false;
    });
  }, [pending, messages, userId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending.length, chat.id]);

  const people = chat.members.filter((m) => m.member_type === "member");
  const agents = chat.members.filter((m) => m.member_type === "agent");
  const candidates = useMemo<ComposerMention[]>(
    () =>
      chat.members
        .filter((m) => !(m.member_type === "member" && m.member_id === userId))
        .map((m) => ({ type: m.member_type, id: m.member_id, name: getActorName(m.member_type, m.member_id) })),
    [chat.members, getActorName, userId],
  );

  const deliver = useCallback(
    async (localId: string, content: string, attachmentIds: string[], refMessageId?: string, note?: FocusNote) => {
      setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "sending" } : p)));
      try {
        await send.mutateAsync({ content, attachmentIds, refMessageId, ...(note ? { focusNote: note } : {}) });
        setPending((prev) => prev.filter((p) => p.localId !== localId));
      } catch {
        setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "failed" } : p)));
      }
    },
    [send],
  );

  const peer = directChatPeer(chat, userId);
  const title = chatDisplayTitle(chat, userId, getActorName);
  const subtitle = peer
    ? peer.member_type === "agent"
      ? t(($) => $.contacts.agent)
      : t(($) => $.contacts.person)
    : t(($) => $.thread.subtitle, {
        people: t(($) => $.thread.people, { count: people.length }),
        agents: t(($) => $.thread.agents, { count: agents.length }),
      });

  const queue = (content: string, attachmentIds: string[], refMessageId?: string) => {
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const knownIds = new Set(messages.map((m) => m.id));
    const note = focusNote?.name && focusNote.path ? { name: focusNote.name, path: focusNote.path } : undefined;
    setPending((prev) => [...prev, { localId, content, attachmentIds, refMessageId, focusNote: note, status: "sending", knownIds }]);
    void deliver(localId, content, attachmentIds, refMessageId, note);
  };

  const onSend = (content: string, attachmentIds: string[]) => {
    const refMessageId = composerQuote?.id;
    setQuoteId(null);
    queue(content, attachmentIds, refMessageId);
  };

  const leaveSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openForward = () => {
    const ids = messages.filter((m) => selected.has(m.id) && canForwardMessage(m)).map((m) => m.id);
    if (ids.length === 0) return;
    setForwardIds(ids);
  };

  const confirmForward = async (targets: string[], note: string) => {
    const chosen = messages.filter((m) => forwardIds?.includes(m.id) && canForwardMessage(m));
    if (chosen.length === 0 || targets.length === 0) return null;
    const card = encodeChatHistory({
      messages: chosen.map((m) => ({
        author_name: getActorName(m.author_type, m.author_id),
        content: historyContentOf(m),
        created_at: m.created_at,
      })),
    });
    if (utf8Size(card) > CHAT_HISTORY_MAX_BYTES) {
      toast.error(t(($) => $.thread.forward_too_large));
      return null;
    }
    try {
      const result = await forward.mutateAsync({ targets, card, note });
      if (result.failed.length > 0) toast.error(t(($) => $.thread.forward_failed));
      else if (result.noteFailed.length > 0) toast.error(t(($) => $.thread.forward_note_failed));
      return result;
    } catch {
      toast.error(t(($) => $.thread.forward_failed));
      return null;
    }
  };

  // A starter is sent as is and leaves the composer's draft and quote alone.
  const peerStarters =
    peer?.member_type === "agent"
      ? configuredConversationStarters(agentList.find((a) => a.id === peer.member_id))
      : [];
  const memberAgentIds = useMemo(() => new Set(agents.map((m) => m.member_id)), [agents]);
  const askAgentInGroup = (agentId: string) =>
    peer || !memberAgentIds.has(agentId)
      ? undefined
      : (prompt: string) => {
          const name = getActorName("agent", agentId);
          queue(`${encodeMentions(`@${name}`, [{ type: "agent", id: agentId, name }])} ${prompt}`, []);
        };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {mobileNav ? (
        <MobileLevelHeader
          title={title}
          subtitle={subtitle}
          backHref={mobileNav.backHref}
          backLabel={t(($) => $.thread.back)}
          action={
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={<AppLink href={mobileNav.settingsHref} />}
              aria-label={peer ? t(($) => $.contacts.view_profile) : t(($) => $.thread.settings)}
            >
              <MoreHorizontal />
            </Button>
          }
        />
      ) : (
        <header className="relative flex h-14 shrink-0 items-center gap-3 border-b px-5">
          <div className="absolute inset-0">
            <DragStrip />
          </div>
          <div className="relative min-w-0 flex-1">
            <h1 className="truncate text-body-lg font-semibold">{title}</h1>
            <p className="truncate text-caption text-muted-foreground">{subtitle}</p>
          </div>
          {onAskAI && <AskAIBadge onClick={() => onAskAI()} />}
          <Button
            variant={panelOpen ? "secondary" : "ghost"}
            size="icon-sm"
            className="relative"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={onTogglePanel}
            aria-pressed={panelOpen}
            aria-label={t(($) => $.thread.toggle_panel)}
          >
            <PanelRight />
          </Button>
        </header>
      )}

      <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto pt-3.5 pb-1.5", mobileNav ? "px-3" : "px-6")}>
        {isError ? (
          <p className="py-10 text-center text-body text-muted-foreground">{t(($) => $.thread.load_failed)}</p>
        ) : messages.length === 0 && visiblePending.length === 0 ? (
          <p className="py-10 text-center text-body text-muted-foreground">{t(($) => $.thread.no_messages)}</p>
        ) : (
          <ol className="flex flex-col">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const mine = m.author_type === "member" && m.author_id === userId;
              return (
                <li key={m.id} data-message-id={m.id} className="flex flex-col">
                  {needsTimeSeparator(prev?.created_at, m.created_at) && (
                    <TimeSeparator iso={m.created_at} showDay={!prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at))} />
                  )}
                  {selecting && canForwardMessage(m) ? (
                    <SelectableRow selected={selected.has(m.id)} onToggle={() => toggleSelected(m.id)}>
                      <MessageRow
                        message={m}
                        mine={mine}
                        authorName={getActorName(m.author_type, m.author_id)}
                        onOpenProfile={mobileNav?.onOpenProfile}
                        agentClicks={agentClicks}
                        onPickConversationStarter={
                          m.author_type === "agent" ? askAgentInGroup(m.author_id) : undefined
                        }
                        quote={m.ref_message_id ? quoteOf(m.ref_message_id) : undefined}
                        onJumpToQuote={jumpTo}
                        actions={actionsFor(m)}
                        iosMenu={!!mobileNav}
                        onOpenHistory={mobileNav?.onOpenHistory}
                        onOpenProgress={mobileNav?.onOpenProgress}
                        selecting
                      />
                    </SelectableRow>
                  ) : (
                    <MessageRow
                      message={m}
                      mine={mine}
                      authorName={getActorName(m.author_type, m.author_id)}
                      onOpenProfile={mobileNav?.onOpenProfile}
                      agentClicks={agentClicks}
                      onPickConversationStarter={
                        m.author_type === "agent" ? askAgentInGroup(m.author_id) : undefined
                      }
                      quote={m.ref_message_id ? quoteOf(m.ref_message_id) : undefined}
                      onJumpToQuote={jumpTo}
                      actions={actionsFor(m)}
                      iosMenu={!!mobileNav}
                      onOpenHistory={mobileNav?.onOpenHistory}
                      onOpenProgress={mobileNav?.onOpenProgress}
                      selecting={selecting}
                    />
                  )}
                </li>
              );
            })}
            {visiblePending.map((p) => (
              <li key={p.localId} className="flex flex-col">
                <PendingRow
                  message={p}
                  userId={userId}
                  quote={p.refMessageId ? quoteOf(p.refMessageId) : undefined}
                  onJumpToQuote={jumpTo}
                  onRetry={() => void deliver(p.localId, p.content, p.attachmentIds, p.refMessageId, p.focusNote)}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        {selecting ? (
          <div className="flex gap-2 px-4 py-3">
            <Button type="button" className="flex-1" disabled={selected.size === 0} onClick={openForward}>
              {t(($) => $.thread.forward)}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={leaveSelect}>
              {t(($) => $.thread.cancel)}
            </Button>
          </div>
        ) : (
          <>
        <ConversationStarterChips
          starters={peerStarters}
          onPick={(prompt) => queue(prompt, [])}
          className="px-4 pt-2"
        />
        <ChatComposer
          key={chat.id}
          chatId={chat.id}
          chatTitle={title}
          candidates={candidates}
          onSend={onSend}
          quote={composerQuote}
          onCancelQuote={() => setQuoteId(null)}
        />
          </>
        )}
      </div>

      <ForwardDialog
        key={forwardIds?.join("\0") ?? "closed"}
        open={forwardIds !== null}
        chats={asGroupChats(chatList.data ?? EMPTY_CHATS)}
        userId={userId}
        loading={chatList.isLoading}
        pending={forward.isPending}
        onOpenChange={(open) => {
          if (!open) setForwardIds(null);
        }}
        onConfirm={confirmForward}
        onDone={() => {
          setForwardIds(null);
          leaveSelect();
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.thread.delete_title)}</AlertDialogTitle>
            <AlertDialogDescription>{t(($) => $.thread.delete_description)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{t(($) => $.thread.cancel)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={remove.isPending}>
              {t(($) => $.thread.delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface MessageActions {
  onCopy: () => void;
  onQuote: () => void;
  /** Absent when this person may not delete the message. */
  onDelete?: () => void;
  /** Receives the text highlighted inside the message; empty for the whole message. */
  onAskAI?: (text: string) => void;
  /** Thinking bubbles keep the entries visible and refuse them. */
  canForward: boolean;
  onForward: () => void;
  onMultiSelect: () => void;
}

/**
 * Right click opens the message's actions; so does a long press on a touch
 * screen. Phones get the iOS menu look: roomy rows, trailing icons, and the
 * pressed bubble lifted slightly while the menu is open. Text highlighted in
 * the message when the menu opens goes with Ask AI.
 *
 * Order: Ask AI, Copy | Forward, multi-select, Quote | Delete.
 */
function MessageMenu({ actions, ios, children }: { actions: MessageActions; ios?: boolean; children: React.ReactNode }) {
  const { t } = useT("im");
  const highlightRef = useRef("");
  const onAskAI = actions.onAskAI;
  type MenuItem = {
    key: string;
    icon: typeof Copy;
    label: string;
    onClick: () => void;
    destructive?: boolean;
    disabled?: boolean;
  };
  const groups: MenuItem[][] = [
    [
      ...(onAskAI
        ? [{ key: "ask", icon: Sparkles, label: t(($) => $.search.ask_ai), onClick: () => onAskAI(highlightRef.current) }]
        : []),
      { key: "copy", icon: Copy, label: t(($) => $.thread.copy), onClick: actions.onCopy },
    ],
    [
      {
        key: "forward",
        icon: Forward,
        label: t(($) => $.thread.forward),
        onClick: actions.onForward,
        disabled: !actions.canForward,
      },
      {
        key: "select",
        icon: ListChecks,
        label: t(($) => $.thread.select_messages),
        onClick: actions.onMultiSelect,
        disabled: !actions.canForward,
      },
      { key: "quote", icon: Quote, label: t(($) => $.thread.quote), onClick: actions.onQuote },
    ],
    ...(actions.onDelete
      ? [[{ key: "delete", icon: Trash2, label: t(($) => $.thread.delete), onClick: actions.onDelete, destructive: true }]]
      : []),
  ];
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div />}
        onContextMenu={(e) => {
          highlightRef.current = highlightedTextWithin(e.currentTarget);
        }}
        className={cn(
          "max-w-full min-w-0 select-text [-webkit-touch-callout:none] [@media(hover:none)]:select-none",
          ios
            ? "transition-transform duration-200 data-[popup-open]:scale-[1.03] motion-reduce:transition-none"
            : "data-[popup-open]:opacity-80",
        )}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className={cn(ios && "min-w-56 rounded-[14px] bg-surface-raised/85 p-0 backdrop-blur-xl")}
      >
        {groups.map((group, index) => (
          <Fragment key={group[0]!.key}>
            {index > 0 && <ContextMenuSeparator className={cn(ios && "mx-0 my-0 bg-border/60")} />}
            {group.map(({ key, icon: Icon, label, onClick, destructive, disabled }) => (
              <ContextMenuItem
                key={key}
                variant={destructive ? "destructive" : "default"}
                disabled={disabled}
                onClick={onClick}
                className={cn(ios && "h-11 justify-between rounded-none px-4 text-body-lg [&_svg:not([class*='size-'])]:size-5")}
              >
                {ios ? (
                  <>
                    {label}
                    <Icon />
                  </>
                ) : (
                  <>
                    <Icon />
                    {label}
                  </>
                )}
              </ContextMenuItem>
            ))}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** One line under a bubble naming the message it quotes; `null` means that message is gone. */
function CancelledNotice({ notice }: { notice: CancelledNoticeData }) {
  const { t } = useT("im");
  const [open, setOpen] = useState(false);
  const hasDetails = notice.request !== undefined || notice.response !== undefined;
  return (
    <div className="my-3.5 flex flex-col items-center gap-1 px-6" role="status">
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-caption text-destructive">
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {t(($) => $.thread.cancelled_in_progress)}
        </span>
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t(($) => $.thread.cancelled_details)}
          </button>
        ) : null}
      </p>
      {notice.trigger ? (
        <p className="w-full truncate text-center text-caption text-muted-foreground" title={notice.trigger}>
          {notice.trigger}
        </p>
      ) : null}
      {hasDetails ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[min(80vh,640px)] flex-col gap-3 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t(($) => $.thread.cancelled_details_title)}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {notice.request !== undefined ? (
                <section className="space-y-1.5">
                  <h3 className="text-caption font-medium text-muted-foreground">{t(($) => $.thread.cancelled_request)}</h3>
                  <JsonViewer value={notice.request} />
                </section>
              ) : null}
              {notice.response !== undefined ? (
                <section className="space-y-1.5">
                  <h3 className="text-caption font-medium text-muted-foreground">{t(($) => $.thread.cancelled_response)}</h3>
                  <JsonViewer value={notice.response} />
                </section>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function QuotedLine({ quote, onJump }: { quote: ComposerQuote | null; onJump: (id: string) => void }) {
  const { t } = useT("im");
  if (!quote) {
    return (
      <span className="block max-w-full truncate px-2 text-caption text-muted-foreground">{t(($) => $.thread.quote_deleted)}</span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onJump(quote.id)}
      className="block max-w-full min-w-0 rounded-md bg-muted px-2 py-0.5 text-left text-caption text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <QuoteText quote={quote} />
    </button>
  );
}

/** Shows the day only when it changes from the previous message; otherwise just the clock. */
function TimeSeparator({ iso, showDay }: { iso: string; showDay: boolean }) {
  const { t } = useT("im");
  const label = showDay
    ? formatStamp(iso, new Date(), (time) => t(($) => $.thread.yesterday, { time }), { withTime: true })
    : formatClock(iso);
  return <p className="mt-4 mb-[18px] text-center text-caption text-muted-foreground">{label}</p>;
}

/** 36px squircle, shared by both sides of the conversation. */
const MESSAGE_AVATAR_CLASS = "size-9!";

function MessageRow({
  message,
  mine,
  authorName,
  onOpenProfile,
  agentClicks,
  onPickConversationStarter,
  quote,
  onJumpToQuote,
  actions,
  iosMenu,
  onOpenHistory,
  onOpenProgress,
  selecting,
}: {
  message: Comment;
  mine: boolean;
  authorName: string;
  /** Replaces the hover card and agent modal with a page level (phones). */
  onOpenProfile?: (actorType: string, actorId: string) => void;
  /** An agent author's profile on click, its direct chat on double click. */
  agentClicks: AgentClickActions;
  /** Sends a starter from the agent author's hover card. */
  onPickConversationStarter?: (prompt: string) => void;
  /** Set when the message quotes another; `null` once that one is deleted. */
  quote?: ComposerQuote | null;
  onJumpToQuote: (id: string) => void;
  actions: MessageActions;
  /** Phones: style the long-press menu after iOS. */
  iosMenu?: boolean;
  /** Phones open the card on its own page. */
  onOpenHistory?: (messageId: string) => void;
  /** Phones open the run log as its own page instead of a dialog. */
  onOpenProgress?: (taskId: string) => void;
  /** Multi-select hides the menu; a click on the row toggles the message. */
  selecting?: boolean;
}) {
  const time = formatClock(message.created_at);

  const cancelled = parseCancelledNotice(message.content);
  if (cancelled) {
    return <CancelledNotice notice={cancelled} />;
  }

  if (message.author_type === "system" || message.type === "status_change" || message.type === "system") {
    return <p className="my-3.5 text-center text-caption text-muted-foreground">{message.content}</p>;
  }

  const isAgent = message.author_type === "agent";
  const chatWithAgent = isAgent ? () => agentClicks.chat(message.author_id) : undefined;
  const avatar = (
    <span className="flex" onDoubleClick={chatWithAgent}>
      <ActorAvatar
        actorType={message.author_type}
        actorId={message.author_id}
        size="xl"
        className={MESSAGE_AVATAR_CLASS}
        enableHoverCard={!onOpenProfile}
        onPickConversationStarter={onPickConversationStarter}
        onOpenProfile={
          isAgent
            ? () => agentClicks.open(message.author_id)
            : onOpenProfile
              ? () => onOpenProfile(message.author_type, message.author_id)
              : undefined
        }
      />
    </span>
  );

  const thinkingTask = thinkingTaskId(message);
  const history = isChatHistoryContent(message.content);
  const wrap = (node: React.ReactNode) =>
    selecting ? node : (
      <MessageMenu actions={actions} ios={iosMenu}>
        {node}
      </MessageMenu>
    );
  const bubble = history ? (
    <ChatHistoryCard
      content={message.content}
      interactive={!selecting}
      onOpen={onOpenHistory && !selecting ? () => onOpenHistory(message.id) : undefined}
    />
  ) : (
    <Bubble mine={mine} title={time}>
      <RichContent content={message.content} attachments={message.attachments} density="compact" />
    </Bubble>
  );

  return (
    <MessageLayout mine={mine} avatar={avatar} authorName={mine ? undefined : authorName} onAuthorDoubleClick={chatWithAgent}>
      {thinkingTask ? (
        <ThinkingBubble
          chatId={message.issue_id}
          taskId={thinkingTask}
          agentId={message.author_id}
          agentName={authorName ?? ""}
          title={time}
          wrap={wrap}
          onOpenProgress={onOpenProgress}
        />
      ) : (
        wrap(bubble)
      )}
      {quote !== undefined && <QuotedLine quote={quote} onJump={onJumpToQuote} />}
    </MessageLayout>
  );
}

function SelectableRow({
  selected,
  onToggle,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggle();
      }}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md",
        selected ? "bg-accent hover:bg-accent" : "hover:bg-foreground/5",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-3 ml-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-background",
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <div className="pointer-events-none min-w-0 flex-1">{children}</div>
    </div>
  );
}

const thinkingControlClass =
  "shrink-0 opacity-0 transition-opacity group-hover/thinking:opacity-100 group-focus-within/thinking:opacity-100 [@media(hover:none)]:opacity-100";

/** Stands in for the reply with the run's latest progress until the reply replaces it. */
function ThinkingBubble({
  chatId,
  taskId,
  agentId,
  agentName,
  title,
  wrap,
  onOpenProgress,
}: {
  chatId: string;
  taskId: string;
  agentId: string;
  agentName: string;
  title: string;
  wrap: (node: React.ReactNode) => React.ReactNode;
  /** Phones push the run onto its own page. Absent on desktop, which opens the dialog. */
  onOpenProgress?: (taskId: string) => void;
}) {
  const { t } = useT("im");
  const { data } = useTaskMessages(taskId, true);
  const items = useMemo(() => buildTimeline(data ?? []), [data]);
  const { text, activity } = useMemo(() => runProgress(data), [data]);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressFromKeyboard, setProgressFromKeyboard] = useState(false);
  const { data: issueTasks } = useQuery({ ...issueTasksOptions(chatId), enabled: progressOpen });
  const task = issueTasks?.find((item) => item.id === taskId) ?? thinkingRun(chatId, taskId, agentId);
  const cancel = useCancelIssueRun(chatId);
  // The bubble stays until the server rewrites it, so a settled stop keeps the spinner.
  const stopping = cancel.isPending || cancel.isSuccess;
  const progressLabel = t(($) => $.thread.view_progress);
  const activityLabel = !activity
    ? null
    : activity.label ||
      (activity.kind === "tool" ? t(($) => $.thread.activity_tool) : t(($) => $.thread.activity_thinking));
  return (
    <>
      <div className="group/thinking flex max-w-full min-w-0 items-center gap-1">
        {wrap(
          <Bubble title={title} className={cn(text && "opacity-70")}>
            <RichContent content={text ?? THINKING_MESSAGE} density="compact" />
          </Bubble>,
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(thinkingControlClass, "text-muted-foreground", progressOpen && "opacity-100!")}
          aria-label={progressLabel}
          title={progressLabel}
          aria-haspopup={onOpenProgress ? undefined : "dialog"}
          aria-expanded={onOpenProgress ? undefined : progressOpen}
          onClick={(event) => {
            if (onOpenProgress) {
              onOpenProgress(taskId);
              return;
            }
            setProgressFromKeyboard(event.detail === 0);
            setProgressOpen(true);
          }}
        >
          <Info />
        </Button>
      </div>
      {progressOpen && !onOpenProgress && (
        <AgentTranscriptDialog
          open
          onOpenChange={setProgressOpen}
          task={task}
          items={items}
          agentName={agentName}
          isLive
          finalFocus={progressFromKeyboard}
          stopping={stopping}
          onStop={() => cancel.mutate(taskId, { onError: () => toast.error(t(($) => $.thread.stop_failed)) })}
        />
      )}
      {activityLabel && (
        <span className="flex max-w-full min-w-0 items-center gap-1 text-micro text-muted-foreground" aria-live="polite">
          {activity?.kind === "tool" ? (
            <Loader2 aria-hidden className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
          ) : (
            <Brain aria-hidden className="size-3 shrink-0" />
          )}
          <span className="truncate" title={activityLabel}>
            {activityLabel}
          </span>
        </span>
      )}
    </>
  );
}

/** Enough for the progress dialog before the issue's task list has loaded. */
function thinkingRun(chatId: string, taskId: string, agentId: string): AgentTask {
  return {
    id: taskId,
    agent_id: agentId,
    issue_id: chatId,
    runtime_id: "",
    status: "running",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "",
    kind: "comment",
  };
}

function MessageLayout({
  mine,
  avatar,
  authorName,
  onAuthorDoubleClick,
  children,
}: {
  mine: boolean;
  avatar: React.ReactNode;
  authorName?: string;
  onAuthorDoubleClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mb-5 flex items-start gap-2.5", mine && "justify-end")}>
      {!mine && <span className="flex shrink-0">{avatar}</span>}
      <div className={cn("grid min-w-0 max-w-[min(78%,660px)] gap-1 md:max-w-[min(74%,660px)]", mine ? "justify-items-end" : "justify-items-start")}>
        {authorName && (
          <span
            className={cn("mb-0.5 ml-0.5 text-micro text-muted-foreground", onAuthorDoubleClick && "cursor-default select-none")}
            onDoubleClick={onAuthorDoubleClick}
          >
            {authorName}
          </span>
        )}
        {children}
      </div>
      {mine && <span className="flex shrink-0">{avatar}</span>}
    </div>
  );
}

// `.rich-text-editor a` is unlayered CSS painting links in --brand, so the
// in-bubble override needs `!` to win over it.
const BUBBLE_LINK_CLASS = "[&_a]:text-inherit! [&_a]:underline [&_a]:underline-offset-2";

/** Flat bubble with a small tail pointing at the author's avatar. */
function Bubble({ mine, title, className, children }: { mine?: boolean; title?: string; className?: string; children: React.ReactNode }) {
  return (
    <div
      title={title}
      className={cn(
        "relative max-w-full min-w-0 rounded-[6px] px-3 py-[7px] text-body break-words [&_.mention]:text-inherit!",
        "before:absolute before:top-[11px] before:size-2 before:rotate-45 before:bg-inherit before:content-['']",
        BUBBLE_LINK_CLASS,
        mine
          ? "bg-im-bubble-self text-im-bubble-self-foreground before:-right-[3px]"
          : "bg-im-bubble-other text-im-bubble-other-foreground before:-left-[3px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function PendingRow({
  message,
  userId,
  quote,
  onJumpToQuote,
  onRetry,
}: {
  message: PendingMessage;
  userId: string;
  quote?: ComposerQuote | null;
  onJumpToQuote: (id: string) => void;
  onRetry: () => void;
}) {
  const { t } = useT("im");
  return (
    <MessageLayout
      mine
      avatar={<ActorAvatar actorType="member" actorId={userId} size="xl" className={MESSAGE_AVATAR_CLASS} profileLink={false} />}
    >
      <Bubble mine className={cn(message.status === "sending" && "opacity-70")}>
        <RichContent content={message.content} density="compact" />
      </Bubble>
      {quote !== undefined && <QuotedLine quote={quote} onJump={onJumpToQuote} />}
      {message.status === "sending" ? (
        <span className="text-micro text-muted-foreground">{t(($) => $.thread.sending)}</span>
      ) : (
        <span className="flex items-center gap-1 text-micro text-destructive">
          {t(($) => $.thread.failed)}
          <Button variant="ghost" size="xs" onClick={onRetry}>
            <RotateCw />
            {t(($) => $.thread.retry)}
          </Button>
        </span>
      )}
    </MessageLayout>
  );
}
