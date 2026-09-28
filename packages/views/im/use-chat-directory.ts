"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import type { Agent, GroupChatMemberType, MemberWithUser } from "@multica/core/types";

export interface DirectoryEntry {
  type: GroupChatMemberType;
  id: string;
  name: string;
  /** Secondary line: email for people, description for agents. */
  detail: string;
  agent?: Agent;
  member?: MemberWithUser;
}

const EMPTY_MEMBERS: MemberWithUser[] = [];
const EMPTY_AGENTS: Agent[] = [];

/** People and live agents of the workspace, as candidates for chat membership. */
export function useChatDirectory(wsId: string) {
  const { data: members = EMPTY_MEMBERS } = useQuery(memberListOptions(wsId));
  const { data: agents = EMPTY_AGENTS } = useQuery(agentListOptions(wsId));

  return useMemo(() => {
    const people: DirectoryEntry[] = members.map((m) => ({
      type: "member",
      id: m.user_id,
      name: m.name,
      detail: m.email,
      member: m,
    }));
    const bots: DirectoryEntry[] = agents
      .filter((a) => !a.archived_at)
      .map((a) => ({ type: "agent", id: a.id, name: a.name, detail: a.description, agent: a }));
    const byKey = new Map<string, DirectoryEntry>();
    for (const e of [...people, ...bots]) byKey.set(`${e.type}:${e.id}`, e);
    return { people, agents: bots, byKey, agentList: agents };
  }, [members, agents]);
}

export function entryKey(type: string, id: string): string {
  return `${type}:${id}`;
}

export function matchesQuery(entry: DirectoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return entry.name.toLowerCase().includes(q) || entry.detail.toLowerCase().includes(q);
}
