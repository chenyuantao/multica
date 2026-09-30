"use client";

import { useMemo, useState } from "react";
import { CirclePlus } from "lucide-react";
import type { GroupChat } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { useLocale, useT } from "../i18n";
import { chatActivityAt, formatListStamp, plainTextPreview } from "./im-utils";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";

interface ChatSidebarProps {
  chats: GroupChat[];
  isLoading: boolean;
  isError: boolean;
  selectedId: string | null;
  userId: string;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  className?: string;
}

export function ChatSidebar({ chats, isLoading, isError, selectedId, userId, onSelect, onNewChat, className }: ChatSidebarProps) {
  const { t } = useT("im");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats),
    [chats, q],
  );

  return (
    <ImSidebarShell className={className}>
      <ImSidebarHeader query={query} onQueryChange={setQuery} searchLabel={t(($) => $.sidebar.search)}>
        <button
          type="button"
          onClick={onNewChat}
          aria-label={t(($) => $.sidebar.new_chat)}
          title={t(($) => $.sidebar.new_chat)}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <CirclePlus className="size-[21px]" strokeWidth={1.7} />
        </button>
      </ImSidebarHeader>

      <nav className="min-h-0 flex-1 overflow-y-auto pt-1 pb-3" aria-label={t(($) => $.sidebar.chats)}>
        {isError ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.sidebar.load_failed)}</p>
        ) : !isLoading && visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">
            {q ? t(($) => $.sidebar.no_results) : t(($) => $.sidebar.empty)}
          </p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((chat) => (
              <li key={chat.id} className="border-b border-foreground/5 last:border-b-0">
                <ChatListItem
                  chat={chat}
                  userId={userId}
                  selected={chat.id === selectedId}
                  onSelect={() => onSelect(chat.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>
    </ImSidebarShell>
  );
}

const MOSAIC_SIZE = 40;
const MOSAIC_PADDING = 2;
const MOSAIC_GAP = 1.5;
const MOSAIC_MAX_TILES = 9;

/**
 * Group avatar: a messenger-style mosaic of up to nine members on a grey
 * plate. You always take the last tile so you stay visible in large rooms;
 * an incomplete last row is centered.
 */
export function ChatAvatar({ chat, userId }: { chat: GroupChat; userId: string }) {
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
        <span
          key={`${m.member_type}:${m.member_id}`}
          className="overflow-hidden rounded-[2px] [&>*]:size-full!"
          style={{ width: tile, height: tile }}
        >
          <ActorAvatar actorType={m.member_type} actorId={m.member_id} size="xs" shape="square" profileLink={false} />
        </span>
      ))}
    </span>
  );
}

function ChatListItem({ chat, userId, selected, onSelect }: { chat: GroupChat; userId: string; selected: boolean; onSelect: () => void }) {
  const { t } = useT("im");
  const locale = useLocale();
  const { getActorName } = useActorName();
  const last = chat.last_message;
  const text = last ? plainTextPreview(last.content) : "";
  const preview = !last
    ? t(($) => $.sidebar.no_messages)
    : last.author_type === "system"
      ? text
      : t(($) => $.sidebar.preview, { name: getActorName(last.author_type, last.author_id), text });

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex h-[66px] w-full items-center gap-[11px] px-4.5 text-left transition-colors",
        selected ? "bg-brand/12 hover:bg-brand/12" : "hover:bg-foreground/5",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
      )}
    >
      <ChatAvatar chat={chat} userId={userId} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-body", selected ? "font-semibold" : "font-medium")}>
            {chat.title}
          </span>
          <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
            {formatListStamp(chatActivityAt(chat), locale, new Date())}
          </span>
        </span>
        <span className="mt-[3px] block truncate text-caption text-muted-foreground">{preview}</span>
      </span>
    </button>
  );
}
