"use client";

import { BookOpen, ListTodo, Menu, MessageCircle } from "lucide-react";
import { useWorkspacePaths } from "@multica/core/paths";
import { cn } from "@multica/ui/lib/utils";
import { AppLink } from "../navigation";
import { useT } from "../i18n";
import type { ImRailSection } from "./im-rail";
import { UnreadBadge } from "./unread-badge";
import { useGroupChatUnreadTotal } from "./use-group-chat-unread";

/** Phone section switcher pinned under every tab root. Members and favorites live inside Settings. */
export function MobileTabBar({ active }: { active: ImRailSection }) {
  const { t } = useT("im");
  const paths = useWorkspacePaths();
  const chatsUnread = useGroupChatUnreadTotal();
  const tabs = [
    { id: "chats", href: paths.im(), label: t(($) => $.tabs.chats), icon: MessageCircle },
    { id: "reminder", href: paths.reminder(), label: t(($) => $.rail.reminder), icon: ListTodo },
    { id: "knowledge", href: paths.knowledge(), label: t(($) => $.tabs.knowledge), icon: BookOpen },
    { id: "settings", href: paths.settings(), label: t(($) => $.tabs.me), icon: Menu },
  ] as const;

  return (
    <nav
      aria-label={t(($) => $.rail.sections)}
      className="flex shrink-0 border-t bg-sidebar pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map(({ id, href, label, icon: Icon }) => (
        <AppLink
          key={id}
          href={href}
          aria-current={active === id ? "page" : undefined}
          className={cn(
            "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
            active === id && "text-brand",
          )}
        >
          <span className="relative flex">
            <Icon className="size-6" strokeWidth={1.8} />
            {id === "chats" && (
              <UnreadBadge
                count={chatsUnread}
                label={t(($) => $.sidebar.unread, { count: chatsUnread })}
                className="absolute -top-1.5 left-4"
              />
            )}
          </span>
          <span className="text-micro">{label}</span>
        </AppLink>
      ))}
    </nav>
  );
}
