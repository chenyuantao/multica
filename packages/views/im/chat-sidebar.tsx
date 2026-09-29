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

/** Group avatar: the other members as a tiled mosaic, or a single avatar for 1:1-sized rooms. */
export function ChatAvatar({ chat, userId }: { chat: GroupChat; userId: string }) {
  const others = chat.members.filter((m) => !(m.member_type === "member" && m.member_id === userId));
  const shown = (others.length > 0 ? others : chat.members).slice(0, 4);
  if (shown.length <= 1) {
    const only = shown[0];
    return only ? (
      <ActorAvatar actorType={only.member_type} actorId={only.member_id} size="xl" shape="rounded" profileLink={false} />
    ) : (
      <span className="size-10 shrink-0 rounded-[7px] bg-muted" />
    );
  }
  // Tiles fill the squircle; the 2px seams show the row surface underneath.
  return (
    <span
      className={cn(
        "grid size-10 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-[7px] [&>*]:size-full!",
        shown.length === 2 && "[&>*]:row-span-2",
        shown.length === 3 && "[&>*:first-child]:col-span-2",
      )}
    >
      {shown.map((m) => (
        <ActorAvatar
          key={`${m.member_type}:${m.member_id}`}
          actorType={m.member_type}
          actorId={m.member_id}
          size="sm"
          shape="square"
          profileLink={false}
        />
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
