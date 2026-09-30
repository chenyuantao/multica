"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, MoreHorizontal, PanelRight, RotateCw } from "lucide-react";
import { useTaskMessages } from "@multica/core/chat/queries";
import { groupChatMessagesOptions, useSendGroupChatMessage } from "@multica/core/group-chats";
import { useActorName } from "@multica/core/workspace/hooks";
import type { Comment, GroupChat } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { ActorAvatar } from "../common/actor-avatar";
import { RichContent } from "../rich-content";
import { useLocale, useT } from "../i18n";
import { useOpenAgentDetail } from "../modals/agent-detail";
import { AppLink } from "../navigation";
import { DragStrip } from "../platform";
import { ChatComposer } from "./chat-composer";
import {
  THINKING_MESSAGE,
  dayRelation,
  formatClock,
  isSameDay,
  latestProgressText,
  needsTimeSeparator,
  thinkingTaskId,
  type ComposerMention,
} from "./im-utils";

interface PendingMessage {
  localId: string;
  content: string;
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
  /** Mobile stacked layout: links back to the chat list and on to chat settings. */
  mobileNav?: { backHref: string; settingsHref: string };
}

const EMPTY_COMMENTS: Comment[] = [];

export function ChatThread({ wsId, chat, userId, panelOpen, onTogglePanel, mobileNav }: ChatThreadProps) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const { data = EMPTY_COMMENTS, isError } = useQuery(groupChatMessagesOptions(wsId, chat.id));
  const send = useSendGroupChatMessage(wsId, chat.id);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPending([]), [chat.id]);

  const messages = useMemo(
    () =>
      data
        .filter((c) => !c.deleted_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
    [data],
  );

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
    async (localId: string, content: string) => {
      setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "sending" } : p)));
      try {
        await send.mutateAsync(content);
        setPending((prev) => prev.filter((p) => p.localId !== localId));
      } catch {
        setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "failed" } : p)));
      }
    },
    [send],
  );

  const onSend = (content: string) => {
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const knownIds = new Set(messages.map((m) => m.id));
    setPending((prev) => [...prev, { localId, content, status: "sending", knownIds }]);
    void deliver(localId, content);
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className={cn("relative flex h-14 shrink-0 items-center gap-3 border-b", mobileNav ? "px-2" : "px-5")}>
        <div className="absolute inset-0">
          <DragStrip />
        </div>
        {mobileNav && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            nativeButton={false}
            render={<AppLink href={mobileNav.backHref} />}
            aria-label={t(($) => $.thread.back)}
          >
            <ChevronLeft />
          </Button>
        )}
        <div className="relative min-w-0 flex-1">
          <h1 className="truncate text-body-lg font-semibold">{chat.title}</h1>
          <p className="truncate text-caption text-muted-foreground">
            {t(($) => $.thread.subtitle, {
              people: t(($) => $.thread.people, { count: people.length }),
              agents: t(($) => $.thread.agents, { count: agents.length }),
            })}
          </p>
        </div>
        {mobileNav ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            nativeButton={false}
            render={<AppLink href={mobileNav.settingsHref} />}
            aria-label={t(($) => $.thread.settings)}
          >
            <MoreHorizontal />
          </Button>
        ) : (
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
        )}
      </header>

      <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto pt-3.5 pb-1.5", mobileNav ? "px-3" : "px-6")}>
        {isError ? (
          <p className="py-10 text-center text-body text-muted-foreground">{t(($) => $.thread.load_failed)}</p>
        ) : messages.length === 0 && visiblePending.length === 0 ? (
          <p className="py-10 text-center text-body text-muted-foreground">{t(($) => $.thread.no_messages)}</p>
        ) : (
          <ol className="flex flex-col">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              return (
                <li key={m.id} className="flex flex-col">
                  {needsTimeSeparator(prev?.created_at, m.created_at) && (
                    <TimeSeparator iso={m.created_at} showDay={!prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at))} />
                  )}
                  <MessageRow
                    message={m}
                    mine={m.author_type === "member" && m.author_id === userId}
                    authorName={getActorName(m.author_type, m.author_id)}
                  />
                </li>
              );
            })}
            {visiblePending.map((p) => (
              <li key={p.localId} className="flex flex-col">
                <PendingRow message={p} userId={userId} onRetry={() => void deliver(p.localId, p.content)} />
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <ChatComposer chatTitle={chat.title} candidates={candidates} onSend={onSend} />
      </div>
    </section>
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

function MessageRow({ message, mine, authorName }: { message: Comment; mine: boolean; authorName: string }) {
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
      enableHoverCard
      onOpenProfile={message.author_type === "agent" ? () => openAgentDetail(message.author_id) : undefined}
    />
  );

  const thinkingTask = thinkingTaskId(message);

  return (
    <MessageLayout mine={mine} avatar={avatar} authorName={mine ? undefined : authorName}>
      {thinkingTask ? (
        <ThinkingBubble taskId={thinkingTask} title={time} />
      ) : (
        <Bubble mine={mine} title={time}>
          <RichContent content={message.content} attachments={message.attachments} density="compact" />
        </Bubble>
      )}
    </MessageLayout>
  );
}

/** Stands in for the reply with the run's latest progress until the reply replaces it. */
function ThinkingBubble({ taskId, title }: { taskId: string; title: string }) {
  const { data } = useTaskMessages(taskId, true);
  const progress = latestProgressText(data);
  return (
    <Bubble title={title} className={cn(progress && "opacity-70")}>
      <RichContent content={progress ?? THINKING_MESSAGE} density="compact" />
    </Bubble>
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
    <div className={cn("mb-5 flex items-start gap-2.5", mine ? "justify-end pl-15" : "pr-15")}>
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

function PendingRow({ message, userId, onRetry }: { message: PendingMessage; userId: string; onRetry: () => void }) {
  const { t } = useT("im");
  return (
    <MessageLayout
      mine
      avatar={<ActorAvatar actorType="member" actorId={userId} size="xl" className={MESSAGE_AVATAR_CLASS} profileLink={false} />}
    >
      <Bubble mine className={cn(message.status === "sending" && "opacity-70")}>
        <RichContent content={message.content} density="compact" />
      </Bubble>
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
