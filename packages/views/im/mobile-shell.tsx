"use client";

import { BookOpen, ChevronLeft, Menu, MessageCircle, UsersRound } from "lucide-react";
import { useWorkspacePaths } from "@multica/core/paths";
import { cn } from "@multica/ui/lib/utils";
import { AgentDetail } from "../agents/components/agent-detail-page";
import { MemberDetailPage } from "../members/member-detail-page";
import { AppLink, useBackOrReplace } from "../navigation";
import { useT } from "../i18n";
import type { ImRailSection } from "./im-rail";

/** A phone tab root: the section's list above the bottom tab bar. */
export function MobileTabScreen({ active, children }: { active: ImRailSection; children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">{children}</div>
      <MobileTabBar active={active} />
    </div>
  );
}

export function MobileTabBar({ active }: { active: ImRailSection }) {
  const { t } = useT("im");
  const paths = useWorkspacePaths();
  const tabs = [
    { id: "chats", href: paths.im(), label: t(($) => $.tabs.chats), icon: MessageCircle },
    { id: "contacts", href: paths.member(), label: t(($) => $.tabs.contacts), icon: UsersRound },
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
          <Icon className="size-6" strokeWidth={1.8} />
          <span className="text-micro">{label}</span>
        </AppLink>
      ))}
    </nav>
  );
}

/**
 * Steps back to the previous level, or replaces with `fallback` when the level
 * was opened cold (a shared link, a refresh) and history would leave the app.
 */
export function MobileBackButton({ fallback, label }: { fallback: string; label: string }) {
  const backOrReplace = useBackOrReplace();
  return (
    <button
      type="button"
      onClick={() => backOrReplace(fallback)}
      aria-label={label}
      className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}

/** A pushed phone level: back on the left, centered title, optional action on the right. */
export function MobileLevel({
  title,
  backHref,
  backLabel,
  action,
  children,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
      <MobileLevelHeader title={title} backHref={backHref} backLabel={backLabel} action={action} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

export function MobileLevelHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  backHref: string;
  backLabel: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b bg-sidebar px-1">
      <MobileBackButton fallback={backHref} label={backLabel} />
      <div className="min-w-0 text-center">
        <h1 className="truncate text-body-lg font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-micro text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex justify-end">{action}</div>
    </header>
  );
}

/** `contact=agent:<id>` / `contact=member:<id>` addresses a profile level. */
export function parseContactParam(value: string | null): { type: "agent" | "member"; id: string } | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  const type = value.slice(0, sep);
  const id = value.slice(sep + 1);
  if (sep < 0 || !id || (type !== "agent" && type !== "member")) return null;
  return { type, id };
}

/** The member or agent page, embedded as a level whose header owns the way back. */
export function MobileContactDetail({
  contact,
  backHref,
  backLabel,
}: {
  contact: { type: "agent" | "member"; id: string };
  backHref: string;
  backLabel: string;
}) {
  const backOrReplace = useBackOrReplace();
  return (
    <MobileLevel title="" backHref={backHref} backLabel={backLabel}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {contact.type === "agent" ? (
          <AgentDetail
            key={contact.id}
            agentId={contact.id}
            presentation="embedded"
            onClose={() => backOrReplace(backHref)}
          />
        ) : (
          <MemberDetailPage key={contact.id} userId={contact.id} embedded />
        )}
      </div>
    </MobileLevel>
  );
}
