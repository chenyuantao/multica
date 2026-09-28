"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleMinus, HardDrive, UserPlus } from "lucide-react";
import { useRemoveGroupChatMember } from "@multica/core/group-chats";
import { runtimeDisplayName, runtimeListOptions } from "@multica/core/runtimes";
import { useActorName } from "@multica/core/workspace/hooks";
import type { Agent, AgentRuntime, GroupChat, GroupChatMember } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { ActorAvatar } from "../common/actor-avatar";
import { useT } from "../i18n";
import { AddMemberDialog } from "./add-member-dialog";
import { useChatDirectory } from "./use-chat-directory";

interface ChatDetailsPanelProps {
  wsId: string;
  chat: GroupChat;
  userId: string;
}

type Availability = "online" | "unstable" | "offline";

const EMPTY_RUNTIMES: AgentRuntime[] = [];

export function ChatDetailsPanel({ wsId, chat, userId }: ChatDetailsPanelProps) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const { agentList } = useChatDirectory(wsId);
  const { data: runtimes = EMPTY_RUNTIMES } = useQuery(runtimeListOptions(wsId));
  const removeMember = useRemoveGroupChatMember(wsId, chat.id);
  const [addOpen, setAddOpen] = useState(false);

  const isCreator = chat.creator_type === "member" && chat.creator_id === userId;
  const people = chat.members.filter((m) => m.member_type === "member");
  const agentMembers = chat.members.filter((m) => m.member_type === "agent");
  const agentsById = useMemo(() => new Map(agentList.map((a) => [a.id, a])), [agentList]);
  const runtimesById = useMemo(() => new Map(runtimes.map((r) => [r.id, r])), [runtimes]);

  const runs = useMemo(() => {
    const groups = new Map<string, { name: string; availability: Availability; agentNames: string[] }>();
    for (const m of agentMembers) {
      const agent = agentsById.get(m.member_id);
      if (!agent?.runtime_id) continue;
      const runtime = runtimesById.get(agent.runtime_id);
      const entry = groups.get(agent.runtime_id) ?? {
        name: runtime ? runtimeDisplayName(runtime) : agent.runtime_id.slice(0, 8),
        availability: runtime?.status ?? agent.runtime_availability ?? "offline",
        agentNames: [],
      };
      entry.agentNames.push(agent.name);
      groups.set(agent.runtime_id, entry);
    }
    return [...groups.entries()];
  }, [agentMembers, agentsById, runtimesById]);

  const remove = async (m: GroupChatMember) => {
    try {
      await removeMember.mutateAsync({ memberType: m.member_type, memberId: m.member_id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.panel.remove_failed));
    }
  };

  const canRemove = (m: GroupChatMember) =>
    isCreator && !(m.member_type === "member" && m.member_id === chat.creator_id);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l bg-muted/40 px-4 pt-16 pb-4">
      <PanelSection title={t(($) => $.panel.agents)}>
        {agentMembers.length === 0 ? (
          <p className="px-3 py-3 text-label text-muted-foreground">{t(($) => $.panel.no_agents)}</p>
        ) : (
          agentMembers.map((m) => (
            <MemberRow
              key={m.member_id}
              member={m}
              name={getActorName("agent", m.member_id)}
              detail={agentDetail(agentsById.get(m.member_id), runtimesById)}
              removable={canRemove(m)}
              removeLabel={t(($) => $.panel.remove, { name: getActorName("agent", m.member_id) })}
              onRemove={() => void remove(m)}
              disabled={removeMember.isPending}
            />
          ))
        )}
      </PanelSection>

      <PanelSection title={t(($) => $.panel.people)}>
        {people.map((m) => (
          <MemberRow
            key={m.member_id}
            member={m}
            name={getActorName("member", m.member_id)}
            detail={[
              m.member_id === chat.creator_id ? t(($) => $.panel.creator) : null,
              m.member_id === userId ? t(($) => $.panel.you) : null,
            ].filter(Boolean).join(" · ")}
            removable={canRemove(m)}
            removeLabel={t(($) => $.panel.remove, { name: getActorName("member", m.member_id) })}
            onRemove={() => void remove(m)}
            disabled={removeMember.isPending}
          />
        ))}
      </PanelSection>

      {isCreator && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus />
            {t(($) => $.panel.add_member)}
          </Button>
          <AddMemberDialog wsId={wsId} chat={chat} open={addOpen} onOpenChange={setAddOpen} />
        </div>
      )}

      {runs.length > 0 && (
        <PanelSection title={t(($) => $.panel.runs)}>
          {runs.map(([id, run]) => (
            <div key={id} className="flex items-center gap-3 px-3 py-2">
              <HardDrive className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{run.name}</span>
                <span className="block truncate text-caption text-muted-foreground">{run.agentNames.join(", ")}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-caption font-medium",
                  run.availability === "online" && "text-success",
                  run.availability === "unstable" && "text-warning",
                  run.availability === "offline" && "text-muted-foreground",
                )}
              >
                {t(($) => $.panel[run.availability])}
              </span>
            </div>
          ))}
        </PanelSection>
      )}
    </aside>
  );
}

function agentDetail(agent: Agent | undefined, runtimesById: Map<string, AgentRuntime>): string {
  if (!agent) return "";
  const runtime = agent.runtime_id ? runtimesById.get(agent.runtime_id) : undefined;
  return runtime ? runtimeDisplayName(runtime) : agent.description;
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-micro font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="divide-y overflow-hidden rounded-xl border bg-background">{children}</div>
    </section>
  );
}

function MemberRow({
  member,
  name,
  detail,
  removable,
  removeLabel,
  onRemove,
  disabled,
}: {
  member: GroupChatMember;
  name: string;
  detail: string;
  removable: boolean;
  removeLabel: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <ActorAvatar actorType={member.member_type} actorId={member.member_id} size="lg" enableHoverCard showStatusDot />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{name}</span>
        {detail && <span className="block truncate text-caption text-muted-foreground">{detail}</span>}
      </span>
      {removable && (
        <Button variant="ghost" size="icon-xs" onClick={onRemove} disabled={disabled} aria-label={removeLabel}>
          <CircleMinus className="text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}
