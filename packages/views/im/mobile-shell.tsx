"use client";

import { MessageCircle } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { Button } from "@multica/ui/components/ui/button";
import { AgentDetail } from "../agents/components/agent-detail-page";
import { MemberDetailPage } from "../members/member-detail-page";
import { useBackOrReplace } from "../navigation";
import { useT } from "../i18n";
import type { ImRailSection } from "./im-rail";
import { MobileBackButton } from "./mobile-back-button";
import { MobileTabBar } from "./mobile-tab-bar";
import { useStartDirectChat } from "./use-direct-chat";

/** A phone tab root: the section's list above the bottom tab bar. */
export function MobileTabScreen({ active, children }: { active: ImRailSection; children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">{children}</div>
      <MobileTabBar active={active} />
    </div>
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
    <header className="grid h-12 shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_minmax(2.75rem,auto)] items-center border-b bg-sidebar px-1">
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
  const { t } = useT("im");
  const backOrReplace = useBackOrReplace();
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const directChat = useStartDirectChat(wsId);
  const isSelf = contact.type === "member" && contact.id === userId;
  const action = isSelf ? null : (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void directChat.start({ member_type: contact.type, member_id: contact.id })}
      disabled={directChat.isPending}
      aria-busy={directChat.isPending}
      aria-label={t(($) => $.contacts.send_message)}
    >
      <MessageCircle />
    </Button>
  );
  return (
    <MobileLevel title="" backHref={backHref} backLabel={backLabel} action={action}>
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
