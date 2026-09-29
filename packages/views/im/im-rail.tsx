"use client";

import { MessageCircle, Settings, UsersRound } from "lucide-react";
import { useWorkspacePaths } from "@multica/core/paths";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { AppLink } from "../navigation";
import { useT } from "../i18n";

export type ImView = "chats" | "contacts";

interface ImRailProps {
  view: ImView;
  userId: string;
  onSelect: (view: ImView) => void;
  className?: string;
}

const railButton =
  "relative flex size-10.5 items-center justify-center rounded-[11px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Section switcher for the IM surface: profile, chats, contacts, settings. */
export function ImRail({ view, userId, onSelect, className }: ImRailProps) {
  const { t } = useT("im");
  const paths = useWorkspacePaths();

  return (
    <nav
      aria-label={t(($) => $.rail.sections)}
      className={cn("flex h-full w-15 shrink-0 flex-col items-center gap-1.5 border-r bg-sidebar-accent pb-3.5", className)}
    >
      <div className="flex h-[58px] shrink-0 items-center">
        <AppLink
          href={`${paths.settings()}?tab=profile`}
          aria-label={t(($) => $.rail.profile)}
          title={t(($) => $.rail.profile)}
          className="flex rounded-md transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95"
        >
          <ActorAvatar actorType="member" actorId={userId} size="lg" shape="rounded" profileLink={false} />
        </AppLink>
      </div>
      {(
        [
          { id: "chats", label: t(($) => $.rail.chats), icon: MessageCircle },
          { id: "contacts", label: t(($) => $.rail.contacts), icon: UsersRound },
        ] as const
      ).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          aria-label={label}
          aria-current={view === id ? "page" : undefined}
          title={label}
          className={cn(railButton, view === id && "text-brand hover:text-brand")}
        >
          <Icon className="size-[23px]" strokeWidth={1.8} />
        </button>
      ))}
      <div className="flex-1" />
      <AppLink
        href={paths.settings()}
        aria-label={t(($) => $.sidebar.settings)}
        title={t(($) => $.sidebar.settings)}
        className={railButton}
      >
        <Settings className="size-[23px]" strokeWidth={1.8} />
      </AppLink>
    </nav>
  );
}
