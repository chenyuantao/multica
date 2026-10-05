"use client";

import { CirclePlus, Pin, PinOff } from "lucide-react";
import { directChatPeer } from "@multica/core/group-chats";
import type { GroupChat } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@multica/ui/components/ui/context-menu";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { useAppForeground } from "../common/use-app-foreground";
import { useT } from "../i18n";
import { chatDraftSummary, useChatDraft } from "./chat-draft";
import { cancelledNoticeTrigger } from "./cancelled-notice";
import { isChatHistoryContent } from "./chat-history";
import { chatActivityAt, chatDisplayTitle, formatStamp, plainTextPreview } from "./im-utils";
import { ImSidebarSearch } from "./im-sidebar-search";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";
import { UnreadBadge } from "./unread-badge";

interface ChatSidebarProps {
  chats: GroupChat[];
  isLoading: boolean;
  isError: boolean;
  selectedId: string | null;
  userId: string;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  onSetPinned: (chatId: string, pinned: boolean) => void;
  /** Phones open the shared search page instead of filtering this list. */
  onOpenSearch?: () => void;
  /** Phones get the iOS menu look on long press. */
  iosMenu?: boolean;
  className?: string;
}

export function ChatSidebar({
  chats,
  isLoading,
  isError,
  selectedId,
  userId,
  onSelect,
  onNewChat,
  onSetPinned,
  onOpenSearch,
  iosMenu,
  className,
}: ChatSidebarProps) {
  const { t } = useT("im");
  // The open chat is read as soon as it lands while the app is in front, so
  // its badge would only flash; in the background it stays visible.
  const foreground = useAppForeground();
  const readingId = foreground ? selectedId : null;

  return (
    <ImSidebarShell className={className}>
      <ImSidebarHeader
        title={t(($) => $.tabs.chats)}
        onOpenSearch={onOpenSearch}
        desktopSearch={<ImSidebarSearch priority="chats" onOpenChat={onSelect} />}
      >
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
        ) : !isLoading && chats.length === 0 ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.sidebar.empty)}</p>
        ) : (
          <ul className="flex flex-col">
            {chats.map((chat) => (
              <li key={chat.id} className="border-b border-foreground/5 last:border-b-0">
                <ChatListMenu pinned={chat.pinned} ios={iosMenu} onSetPinned={(pinned) => onSetPinned(chat.id, pinned)}>
                  <ChatListItem
                    chat={chat}
                    userId={userId}
                    selected={chat.id === selectedId}
                    unread={chat.id === readingId ? 0 : chat.unread_count}
                    onSelect={() => onSelect(chat.id)}
                  />
                </ChatListMenu>
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
 * an incomplete last row is centered. A two-person chat shows the other side.
 */
export function ChatAvatar({ chat, userId }: { chat: GroupChat; userId: string }) {
  const peer = directChatPeer(chat, userId);
  if (peer) {
    return <ActorAvatar actorType={peer.member_type} actorId={peer.member_id} size="xl" profileLink={false} />;
  }
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
        <span key={`${m.member_type}:${m.member_id}`} className="flex overflow-hidden rounded-[2px]">
          <ActorAvatar actorType={m.member_type} actorId={m.member_id} size={tile} shape="square" profileLink={false} />
        </span>
      ))}
    </span>
  );
}

/** Right click, or a long press on a touch screen, opens a chat's list actions. */
function ChatListMenu({
  pinned,
  ios,
  onSetPinned,
  children,
}: {
  pinned: boolean;
  ios?: boolean;
  onSetPinned: (pinned: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useT("im");
  const Icon = pinned ? PinOff : Pin;
  const label = pinned ? t(($) => $.sidebar.unpin) : t(($) => $.sidebar.pin);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block [-webkit-touch-callout:none] data-[popup-open]:bg-foreground/5">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className={cn(ios && "min-w-56 rounded-[14px] bg-surface-raised/85 p-0 backdrop-blur-xl")}
      >
        <ContextMenuItem
          onClick={() => onSetPinned(!pinned)}
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
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ChatListItem({
  chat,
  userId,
  selected,
  unread,
  onSelect,
}: {
  chat: GroupChat;
  userId: string;
  selected: boolean;
  unread: number;
  onSelect: () => void;
}) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const storedDraft = useChatDraft(chat.id);
  // The open chat already shows the composer, so its draft stays out of the list.
  const draft = selected ? "" : chatDraftSummary(storedDraft);
  const last = chat.last_message;
  const text = !last
    ? ""
    : cancelledNoticeTrigger(last.content) !== null
      ? t(($) => $.thread.cancelled_in_progress)
      : isChatHistoryContent(last.content)
        ? t(($) => $.thread.history_footer)
        : plainTextPreview(last.content);
  const preview = !last
    ? t(($) => $.sidebar.no_messages)
    : last.author_type === "system" || directChatPeer(chat, userId)
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
          <span className={cn("min-w-0 flex-1 truncate text-body", selected || unread > 0 ? "font-semibold" : "font-medium")}>
            {chatDisplayTitle(chat, userId, getActorName)}
          </span>
          {chat.pinned && (
            <Pin
              role="img"
              aria-label={t(($) => $.sidebar.pinned)}
              className="size-3 shrink-0 self-center text-muted-foreground"
            />
          )}
          <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
            {formatStamp(chatActivityAt(chat), new Date(), (time) => t(($) => $.thread.yesterday, { time }))}
          </span>
        </span>
        <span className="mt-[3px] flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-caption", unread > 0 ? "text-foreground" : "text-muted-foreground")}>
            {draft ? (
              <>
                <span className="text-destructive">{t(($) => $.sidebar.draft)}</span>
                {` ${draft}`}
              </>
            ) : (
              preview
            )}
          </span>
          <UnreadBadge count={unread} label={t(($) => $.sidebar.unread, { count: unread })} />
        </span>
      </span>
    </button>
  );
}
