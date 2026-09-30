"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, Copy, Loader2, MoreHorizontal, PanelRight, Quote, RotateCw, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTaskMessages } from "@multica/core/chat/queries";
import {
  directChatPeer,
  groupChatMessagesOptions,
  useDeleteGroupChatMessage,
  useSendGroupChatMessage,
} from "@multica/core/group-chats";
import { useCancelIssueRun } from "@multica/core/issues/mutations";
import { useCurrentMember } from "@multica/core/permissions";
import { useActorName } from "@multica/core/workspace/hooks";
import type { Comment, GroupChat } from "@multica/core/types";
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@multica/ui/components/ui/context-menu";
import { ActorAvatar } from "../common/actor-avatar";
import { RichContent } from "../rich-content";
import { useLocale, useT } from "../i18n";
import { useOpenAgentDetail } from "../modals/agent-detail";
import { AppLink } from "../navigation";
import { DragStrip } from "../platform";
import { ChatComposer, QuoteText, type ComposerQuote } from "./chat-composer";
import { MobileLevelHeader } from "./mobile-shell";
import {
  THINKING_MESSAGE,
  chatDisplayTitle,
  dayRelation,
  formatClock,
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
  /** Mobile stacked layout: back to the chat list, on to chat settings, and profiles as page levels. */
  mobileNav?: { backHref: string; settingsHref: string; onOpenProfile: (actorType: string, actorId: string) => void };
}

const EMPTY_COMMENTS: Comment[] = [];

export function ChatThread({ wsId, chat, userId, panelOpen, onTogglePanel, mobileNav }: ChatThreadProps) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const { data = EMPTY_COMMENTS, isError } = useQuery(groupChatMessagesOptions(wsId, chat.id));
  const send = useSendGroupChatMessage(wsId, chat.id);
  const remove = useDeleteGroupChatMessage(wsId, chat.id);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Comment | null>(null);
  const { role } = useCurrentMember(wsId);
  const isAdmin = role === "owner" || role === "admin";
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPending([]);
    setQuoteId(null);
  }, [chat.id]);

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
      const text = plainTextPreview(m.content) || t(($) => $.thread.quote_attachment);
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
      onDelete: mine || isAdmin ? () => setDeleting(m) : undefined,
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
    async (localId: string, content: string, attachmentIds: string[], refMessageId?: string) => {
      setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "sending" } : p)));
      try {
        await send.mutateAsync({ content, attachmentIds, refMessageId });
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

  const onSend = (content: string, attachmentIds: string[]) => {
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const knownIds = new Set(messages.map((m) => m.id));
    const refMessageId = composerQuote?.id;
    setQuoteId(null);
    setPending((prev) => [...prev, { localId, content, attachmentIds, refMessageId, status: "sending", knownIds }]);
    void deliver(localId, content, attachmentIds, refMessageId);
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
                  <MessageRow
                    message={m}
                    mine={mine}
                    authorName={getActorName(m.author_type, m.author_id)}
                    onOpenProfile={mobileNav?.onOpenProfile}
                    quote={m.ref_message_id ? quoteOf(m.ref_message_id) : undefined}
                    onJumpToQuote={jumpTo}
                    actions={actionsFor(m)}
                    iosMenu={!!mobileNav}
                  />
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
                  onRetry={() => void deliver(p.localId, p.content, p.attachmentIds, p.refMessageId)}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <ChatComposer
          key={chat.id}
          chatId={chat.id}
          chatTitle={title}
          candidates={candidates}
          onSend={onSend}
          quote={composerQuote}
          onCancelQuote={() => setQuoteId(null)}
        />
      </div>

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
}

/**
 * Right click opens the message's actions; so does a long press on a touch
 * screen. Phones get the iOS menu look: roomy rows, trailing icons, and the
 * pressed bubble lifted slightly while the menu is open.
 */
function MessageMenu({ actions, ios, children }: { actions: MessageActions; ios?: boolean; children: React.ReactNode }) {
  const { t } = useT("im");
  const items = [
    { key: "copy", icon: Copy, label: t(($) => $.thread.copy), onClick: actions.onCopy },
    { key: "quote", icon: Quote, label: t(($) => $.thread.quote), onClick: actions.onQuote },
    ...(actions.onDelete
      ? [{ key: "delete", icon: Trash2, label: t(($) => $.thread.delete), onClick: actions.onDelete, destructive: true }]
      : []),
  ];
  return (
    <ContextMenu>
      <ContextMenuTrigger
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
        className={cn(
          ios && "min-w-56 divide-y divide-border/60 rounded-[14px] bg-surface-raised/85 p-0 backdrop-blur-xl",
        )}
      >
        {items.map(({ key, icon: Icon, label, onClick, destructive }) => (
          <ContextMenuItem
            key={key}
            variant={destructive ? "destructive" : "default"}
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
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** One line under a bubble naming the message it quotes; `null` means that message is gone. */
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
  const locale = useLocale();
  const time = formatClock(iso, locale);
  const relation = dayRelation(iso, new Date());
  const label = !showDay
    ? time
    : relation === "today"
      ? t(($) => $.thread.today, { time })
      : relation === "yesterday"
        ? t(($) => $.thread.yesterday, { time })
        : new Date(iso).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <p className="mt-4 mb-[18px] text-center text-caption text-muted-foreground">{label}</p>;
}

/** 36px squircle, shared by both sides of the conversation. */
const MESSAGE_AVATAR_CLASS = "size-9!";

function MessageRow({
  message,
  mine,
  authorName,
  onOpenProfile,
  quote,
  onJumpToQuote,
  actions,
  iosMenu,
}: {
  message: Comment;
  mine: boolean;
  authorName: string;
  /** Replaces the hover card and agent modal with a page level (phones). */
  onOpenProfile?: (actorType: string, actorId: string) => void;
  /** Set when the message quotes another; `null` once that one is deleted. */
  quote?: ComposerQuote | null;
  onJumpToQuote: (id: string) => void;
  actions: MessageActions;
  /** Phones: style the long-press menu after iOS. */
  iosMenu?: boolean;
}) {
  const locale = useLocale();
  const openAgentDetail = useOpenAgentDetail();
  const time = formatClock(message.created_at, locale);

  if (message.author_type === "system" || message.type === "status_change" || message.type === "system") {
    return <p className="my-3.5 text-center text-caption text-muted-foreground">{message.content}</p>;
  }

  const avatar = (
    <ActorAvatar
      actorType={message.author_type}
      actorId={message.author_id}
      size="xl"
     
      className={MESSAGE_AVATAR_CLASS}
      enableHoverCard={!onOpenProfile}
      onOpenProfile={
        onOpenProfile
          ? () => onOpenProfile(message.author_type, message.author_id)
          : message.author_type === "agent"
            ? () => openAgentDetail(message.author_id)
            : undefined
      }
    />
  );

  const thinkingTask = thinkingTaskId(message);
  const bubble = (
    <Bubble mine={mine} title={time}>
      <RichContent content={message.content} attachments={message.attachments} density="compact" />
    </Bubble>
  );

  return (
    <MessageLayout mine={mine} avatar={avatar} authorName={mine ? undefined : authorName}>
      {thinkingTask ? (
        <ThinkingBubble chatId={message.issue_id} taskId={thinkingTask} title={time} />
      ) : (
        <MessageMenu actions={actions} ios={iosMenu}>
          {bubble}
        </MessageMenu>
      )}
      {quote !== undefined && <QuotedLine quote={quote} onJump={onJumpToQuote} />}
    </MessageLayout>
  );
}

/** Stands in for the reply with the run's latest progress until the reply replaces it. */
function ThinkingBubble({ chatId, taskId, title }: { chatId: string; taskId: string; title: string }) {
  const { t } = useT("im");
  const { data } = useTaskMessages(taskId, true);
  const { text, activity } = useMemo(() => runProgress(data), [data]);
  const cancel = useCancelIssueRun(chatId);
  // The bubble stays until the server rewrites it, so a settled stop keeps the spinner.
  const stopping = cancel.isPending || cancel.isSuccess;
  const stopLabel = stopping ? t(($) => $.thread.stopping) : t(($) => $.thread.stop);
  const activityLabel = !activity
    ? null
    : activity.label ||
      (activity.kind === "tool" ? t(($) => $.thread.activity_tool) : t(($) => $.thread.activity_thinking));
  return (
    <>
      <div className="group/thinking flex max-w-full min-w-0 items-center gap-1">
        <Bubble title={title} className={cn(text && "opacity-70")}>
          <RichContent content={text ?? THINKING_MESSAGE} density="compact" />
        </Bubble>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            "shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thinking:opacity-100 group-focus-within/thinking:opacity-100 [@media(hover:none)]:opacity-100",
            stopping && "opacity-100!",
          )}
          aria-label={stopLabel}
          title={stopLabel}
          disabled={stopping}
          aria-busy={cancel.isPending}
          onClick={() => cancel.mutate(taskId, { onError: () => toast.error(t(($) => $.thread.stop_failed)) })}
        >
          {stopping ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Square />}
        </Button>
      </div>
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

function MessageLayout({
  mine,
  avatar,
  authorName,
  children,
}: {
  mine: boolean;
  avatar: React.ReactNode;
  authorName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mb-5 flex items-start gap-2.5", mine && "justify-end")}>
      {!mine && <span className="flex shrink-0">{avatar}</span>}
      <div className={cn("grid min-w-0 max-w-[min(74%,660px)] gap-1", mine ? "justify-items-end" : "justify-items-start")}>
        {authorName && <span className="mb-0.5 ml-0.5 text-micro text-muted-foreground">{authorName}</span>}
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
