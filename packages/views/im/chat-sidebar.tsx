"use client";

import { useMemo, useState } from "react";
import { Search, Settings, SquarePen, LayoutGrid } from "lucide-react";
import type { GroupChat } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { useActorName } from "@multica/core/workspace/hooks";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { ActorAvatar } from "../common/actor-avatar";
import { AppLink } from "../navigation";
import { useLocale, useT } from "../i18n";
import { DragStrip } from "../platform";
import { chatActivityAt, formatListStamp, plainTextPreview } from "./im-utils";

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
  const paths = useWorkspacePaths();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats),
    [chats, q],
  );

  return (
    <aside className={cn("flex h-full w-72 shrink-0 flex-col border-r bg-muted/40", className)}>
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <div className="absolute inset-0 -z-0">
          <DragStrip />
        </div>
        <div
          className="relative flex min-w-0 flex-1 items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(($) => $.sidebar.search)}
              aria-label={t(($) => $.sidebar.search)}
              className="h-8 rounded-full bg-background pl-8"
            />
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onNewChat} aria-label={t(($) => $.sidebar.new_chat)}>
            <SquarePen />
          </Button>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label={t(($) => $.sidebar.chats)}>
        {isError ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.sidebar.load_failed)}</p>
        ) : !isLoading && visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">
            {q ? t(($) => $.sidebar.no_results) : t(($) => $.sidebar.empty)}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {visible.map((chat) => (
              <li key={chat.id}>
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

      <div className="flex h-11 shrink-0 items-center gap-1 border-t px-3">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<AppLink href={paths.settings()} />} aria-label={t(($) => $.sidebar.settings)}>
          <Settings />
        </Button>
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<AppLink href={paths.issues()} />} aria-label={t(($) => $.sidebar.workspace)}>
          <LayoutGrid />
        </Button>
      </div>
    </aside>
  );
}

function ChatAvatarStack({ chat, userId }: { chat: GroupChat; userId: string }) {
  const others = chat.members.filter((m) => !(m.member_type === "member" && m.member_id === userId));
  const shown = (others.length > 0 ? others : chat.members).slice(0, 3);
  if (shown.length <= 1) {
    const only = shown[0];
    return only ? (
      <ActorAvatar actorType={only.member_type} actorId={only.member_id} size="xl" profileLink={false} />
    ) : (
      <span className="size-10 rounded-full bg-muted" />
    );
  }
  return (
    <span className="relative block size-10 shrink-0">
      {shown.map((m, i) => (
        <span
          key={`${m.member_type}:${m.member_id}`}
          className={cn(
            "absolute flex rounded-full bg-background ring-2 ring-background",
            shown.length === 2 && (i === 0 ? "top-0 left-0" : "right-0 bottom-0"),
            shown.length === 3 && i === 0 && "top-0 left-2",
            shown.length === 3 && i === 1 && "bottom-0 left-0",
            shown.length === 3 && i === 2 && "right-0 bottom-0",
          )}
        >
          <ActorAvatar actorType={m.member_type} actorId={m.member_id} size="md" profileLink={false} />
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
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        selected ? "bg-accent hover:bg-accent" : "hover:bg-accent/60",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      <ChatAvatarStack chat={chat} userId={userId} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-semibold">{chat.title}</span>
          <span className="shrink-0 text-caption text-muted-foreground">
            {formatListStamp(chatActivityAt(chat), locale, new Date())}
          </span>
        </span>
        <span className="mt-0.5 line-clamp-2 text-label text-muted-foreground">{preview}</span>
      </span>
    </button>
  );
}
