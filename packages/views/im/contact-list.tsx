"use client";

import { useState } from "react";
import { ChevronRight, CirclePlus } from "lucide-react";
import type { GroupChat } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { useT } from "../i18n";
import { ChatAvatar } from "./chat-sidebar";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";
import { entryKey, matchesQuery, type DirectoryEntry } from "./use-chat-directory";

interface ContactListProps {
  people: DirectoryEntry[];
  agents: DirectoryEntry[];
  chats: GroupChat[];
  userId: string;
  selectedKey: string | null;
  onSelect: (entry: DirectoryEntry) => void;
  onOpenChat: (chatId: string) => void;
  onCreateAgent: () => void;
  className?: string;
}

type Folder = "chats" | "people" | "agents";

export function ContactList({ people, agents, chats, userId, selectedKey, onSelect, onOpenChat, onCreateAgent, className }: ContactListProps) {
  const { t } = useT("im");
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<Folder>>(() => new Set());
  const q = query.trim().toLowerCase();
  const toggle = (folder: Folder) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const visibleChats = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;
  const visiblePeople = people.filter((e) => matchesQuery(e, query));
  const visibleAgents = agents.filter((e) => matchesQuery(e, query));
  const empty = visibleChats.length + visiblePeople.length + visibleAgents.length === 0;

  const entryRows = (entries: DirectoryEntry[]) =>
    entries.map((entry) => {
      const key = entryKey(entry.type, entry.id);
      const selected = key === selectedKey;
      return (
        <li key={key} className="border-b border-foreground/5 last:border-b-0">
          <button
            type="button"
            onClick={() => onSelect(entry)}
            aria-current={selected ? "true" : undefined}
            className={cn(rowClass, selected ? "bg-brand/12 hover:bg-brand/12" : "hover:bg-foreground/5")}
          >
            <ActorAvatar actorType={entry.type} actorId={entry.id} size="xl" profileLink={false} showStatusDot />
            <RowCopy title={entry.name} detail={entry.type === "member" && entry.id === userId ? t(($) => $.contacts.you) : entry.detail} />
          </button>
        </li>
      );
    });

  return (
    <ImSidebarShell className={className}>
      <ImSidebarHeader query={query} onQueryChange={setQuery} searchLabel={t(($) => $.contacts.search)}>
        <button
          type="button"
          onClick={onCreateAgent}
          aria-label={t(($) => $.contacts.new_agent)}
          title={t(($) => $.contacts.new_agent)}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <CirclePlus className="size-[21px]" strokeWidth={1.7} />
        </button>
      </ImSidebarHeader>
      <nav className="min-h-0 flex-1 overflow-y-auto pb-3" aria-label={t(($) => $.rail.contacts)}>
        {empty && q ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.contacts.no_results)}</p>
        ) : (
          <>
            <FolderSection label={t(($) => $.contacts.chats)} count={visibleChats.length} open={!closed.has("chats")} onToggle={() => toggle("chats")}>
              {visibleChats.map((chat) => (
                <li key={chat.id} className="border-b border-foreground/5 last:border-b-0">
                  <button type="button" onClick={() => onOpenChat(chat.id)} className={cn(rowClass, "hover:bg-foreground/5")}>
                    <ChatAvatar chat={chat} userId={userId} />
                    <RowCopy title={chat.title} detail={t(($) => $.contacts.members, { count: chat.members.length })} />
                  </button>
                </li>
              ))}
            </FolderSection>
            <FolderSection label={t(($) => $.contacts.people)} count={visiblePeople.length} open={!closed.has("people")} onToggle={() => toggle("people")}>
              {entryRows(visiblePeople)}
            </FolderSection>
            <FolderSection label={t(($) => $.contacts.agents)} count={visibleAgents.length} open={!closed.has("agents")} onToggle={() => toggle("agents")}>
              {entryRows(visibleAgents)}
            </FolderSection>
          </>
        )}
      </nav>
    </ImSidebarShell>
  );
}

const rowClass =
  "flex h-[60px] w-full items-center gap-[11px] px-4.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset";

function RowCopy({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-body">{title}</span>
      {detail && <span className="block truncate text-caption text-muted-foreground">{detail}</span>}
    </span>
  );
}

function FolderSection({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-1 px-3 text-left text-label text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <ChevronRight className={cn("size-[15px] shrink-0 text-faint-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-micro tabular-nums">{count}</span>
      </button>
      {open && count > 0 && <ul className="flex flex-col">{children}</ul>}
    </section>
  );
}
