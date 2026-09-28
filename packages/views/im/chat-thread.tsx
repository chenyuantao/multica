"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelRight, RotateCw } from "lucide-react";
import { groupChatMessagesOptions, useSendGroupChatMessage } from "@multica/core/group-chats";
import { useActorName } from "@multica/core/workspace/hooks";
import type { Comment, GroupChat } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { ActorAvatar } from "../common/actor-avatar";
import { RichContent } from "../rich-content";
import { useLocale, useT } from "../i18n";
import { DragStrip } from "../platform";
import { ChatComposer } from "./chat-composer";
import { dayRelation, formatClock, needsTimeSeparator, type ComposerMention } from "./im-utils";

interface PendingMessage {
  localId: string;
  content: string;
  status: "sending" | "failed";
}

interface ChatThreadProps {
  wsId: string;
  chat: GroupChat;
  userId: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

const EMPTY_COMMENTS: Comment[] = [];

/** Author-name colors for other participants, keyed by a stable hash. */
const NAME_TONES = ["text-brand", "text-success", "text-warning", "text-info"];

function toneFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return NAME_TONES[Math.abs(h) % NAME_TONES.length] ?? "text-brand";
}

export function ChatThread({ wsId, chat, userId, panelOpen, onTogglePanel }: ChatThreadProps) {
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
    setPending((prev) => [...prev, { localId, content, status: "sending" }]);
    void deliver(localId, content);
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className="relative flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <div className="absolute inset-0">
          <DragStrip />
        </div>
        <div className="relative min-w-0 flex-1">
          <h1 className="truncate text-body-lg font-semibold">{chat.title}</h1>
          <p className="truncate text-caption text-muted-foreground">
            {t(($) => $.thread.subtitle, {
              people: t(($) => $.thread.people, { count: people.length }),
              agents: t(($) => $.thread.agents, { count: agents.length }),
            })}
          </p>
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isError ? (
          <p className="py-10 text-center text-body text-muted-foreground">{t(($) => $.thread.load_failed)}</p>
        ) : messages.length === 0 && pending.length === 0 ? (
          <p className="py-10 text-center text-body text-muted-foreground">{t(($) => $.thread.no_messages)}</p>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const separated = needsTimeSeparator(prev?.created_at, m.created_at);
              const sameAuthorAsPrev = !separated && prev?.author_type === m.author_type && prev?.author_id === m.author_id;
              const sameAuthorAsNext =
                next &&
                !needsTimeSeparator(m.created_at, next.created_at) &&
                next.author_type === m.author_type &&
                next.author_id === m.author_id;
              return (
                <li key={m.id} className="flex flex-col">
                  {separated && <TimeSeparator iso={m.created_at} />}
                  <MessageRow
                    message={m}
                    mine={m.author_type === "member" && m.author_id === userId}
                    showName={!sameAuthorAsPrev}
                    showAvatar={!sameAuthorAsNext}
                    authorName={getActorName(m.author_type, m.author_id)}
                  />
                </li>
              );
            })}
            {pending.map((p) => (
              <li key={p.localId} className="flex flex-col">
                <PendingRow message={p} onRetry={() => void deliver(p.localId, p.content)} />
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

function TimeSeparator({ iso }: { iso: string }) {
  const { t } = useT("im");
  const locale = useLocale();
  const time = formatClock(iso, locale);
  const relation = dayRelation(iso, new Date());
  const label =
    relation === "today"
      ? t(($) => $.thread.today, { time })
      : relation === "yesterday"
        ? t(($) => $.thread.yesterday, { time })
        : new Date(iso).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-muted px-3 py-0.5 text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

function MessageRow({
  message,
  mine,
  showName,
  showAvatar,
  authorName,
}: {
  message: Comment;
  mine: boolean;
  showName: boolean;
  showAvatar: boolean;
  authorName: string;
}) {
  const locale = useLocale();
  const time = formatClock(message.created_at, locale);

  if (message.author_type === "system" || message.type === "status_change" || message.type === "system") {
    return (
      <p className="my-2 text-center text-caption text-muted-foreground">{message.content}</p>
    );
  }

  if (mine) {
    return (
      <div className={cn("flex justify-end", showName ? "mt-3" : "mt-1")}>
        <Bubble mine time={time}>
          <RichContent content={message.content} attachments={message.attachments} density="compact" />
        </Bubble>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", showName ? "mt-3" : "mt-1")}>
      {showName && (
        <span className={cn("mb-1 ml-10 text-caption font-semibold", toneFor(message.author_id))}>{authorName}</span>
      )}
      <div className="flex items-end gap-2">
        <span className="w-8 shrink-0">
          {showAvatar && (
            <ActorAvatar actorType={message.author_type} actorId={message.author_id} size="lg" enableHoverCard />
          )}
        </span>
        <Bubble time={time}>
          <RichContent content={message.content} attachments={message.attachments} density="compact" />
        </Bubble>
      </div>
    </div>
  );
}

function Bubble({ mine, time, children }: { mine?: boolean; time: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "relative max-w-[min(34rem,80%)] rounded-2xl px-3.5 py-2 text-body",
        mine ? "bg-brand text-brand-foreground [&_a]:text-brand-foreground [&_a]:underline" : "bg-muted text-foreground",
      )}
    >
      <div className="min-w-0 break-words">{children}</div>
      <span className={cn("mt-0.5 block text-right text-micro", mine ? "text-brand-foreground/75" : "text-muted-foreground")}>
        {time}
      </span>
    </div>
  );
}

function PendingRow({ message, onRetry }: { message: PendingMessage; onRetry: () => void }) {
  const { t } = useT("im");
  return (
    <div className="mt-1 flex flex-col items-end gap-1">
      <div className={cn("max-w-[min(34rem,80%)] rounded-2xl bg-brand px-3.5 py-2 text-body text-brand-foreground", message.status === "sending" && "opacity-70")}>
        <RichContent content={message.content} density="compact" />
      </div>
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
    </div>
  );
}
