"use client";

import { BookOpen, Menu, MessageCircle, UsersRound } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspacePaths } from "@multica/core/paths";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { AppLink } from "../navigation";
import { useT } from "../i18n";

export type ImView = "chats" | "contacts" | "knowledge";

/**
 * `settings` stands for the whole dashboard shell: every non-IM workspace
 * route shares that one rail entry.
 */
export type ImRailSection = ImView | "settings";

interface ImRailProps {
  active: ImRailSection;
  className?: string;
}

const railButton =
  "relative flex size-10.5 items-center justify-center rounded-[11px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const railButtonActive = "text-brand hover:text-brand";

/** Primary section switcher shared by the IM surface and the dashboard shell. */
export function ImRail({ active, className }: ImRailProps) {
  const { t } = useT("im");
  const paths = useWorkspacePaths();
  const userId = useAuthStore((s) => s.user?.id ?? "");

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
          <ActorAvatar actorType="member" actorId={userId} size="lg" profileLink={false} />
        </AppLink>
      </div>
      {(
        [
          { id: "chats", href: paths.im(), label: t(($) => $.rail.chats), icon: MessageCircle },
          { id: "contacts", href: paths.member(), label: t(($) => $.rail.contacts), icon: UsersRound },
          { id: "knowledge", href: paths.knowledge(), label: t(($) => $.rail.knowledge), icon: BookOpen },
        ] as const
      ).map(({ id, href, label, icon: Icon }) => (
        <AppLink
          key={id}
          href={href}
          aria-label={label}
          aria-current={active === id ? "page" : undefined}
          title={label}
          className={cn(railButton, active === id && railButtonActive)}
        >
          <Icon className="size-[23px]" strokeWidth={1.8} />
        </AppLink>
      ))}
      <div className="flex-1" />
      <AppLink
        href={paths.settings()}
        aria-label={t(($) => $.sidebar.settings)}
        aria-current={active === "settings" ? "page" : undefined}
        title={t(($) => $.sidebar.settings)}
        className={cn(railButton, active === "settings" && railButtonActive)}
      >
        <Menu className="size-[23px]" strokeWidth={1.8} />
      </AppLink>
    </nav>
  );
}
