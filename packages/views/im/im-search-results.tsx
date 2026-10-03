"use client";

import { Command as CommandPrimitive } from "cmdk";
import { FileText } from "lucide-react";
import { ActorAvatar } from "../common/actor-avatar";
import { useT } from "../i18n";
import { HighlightText } from "../search/highlight-text";
import { ChatAvatar } from "./chat-sidebar";
import { chatActivityAt, formatStamp } from "./im-utils";
import { noteTitle, parentDir } from "./knowledge-utils";
import type { SearchGroup, SearchRow } from "./use-im-search-groups";
import type { DirectoryEntry } from "./use-chat-directory";
import type { DocNode } from "@multica/core/types";

export const SEARCH_GROUP_CLASS =
  "p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export const SEARCH_ITEM_CLASS =
  "flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-body outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent";

export function SearchResultNotice({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-body text-muted-foreground">{children}</p>;
}

export function SearchResultGroups({
  groups,
  stale,
  highlight,
  noteQuery,
  userId,
  onChoose,
  onExpand,
}: {
  groups: SearchGroup[];
  stale: boolean;
  highlight: string;
  noteQuery: string;
  userId: string;
  onChoose: (row: SearchRow) => void;
  onExpand: (section: SearchGroup["section"]) => void;
}) {
  const { t } = useT("im");
  const now = new Date();
  return groups.map((group) => (
    <CommandPrimitive.Group key={group.section} heading={group.heading} className={SEARCH_GROUP_CLASS}>
      {group.rows.map((row) => (
        <CommandPrimitive.Item
          key={row.value}
          value={row.value}
          disabled={stale}
          onSelect={() => onChoose(row)}
          title={row.kind === "note" ? row.node.path : undefined}
          className={SEARCH_ITEM_CLASS}
        >
          {row.kind === "chat" ? (
            <ChatResult
              row={row}
              userId={userId}
              query={highlight}
              stamp={formatStamp(chatActivityAt(row.chat), now, (time) => t(($) => $.thread.yesterday, { time }))}
            />
          ) : row.kind === "contact" ? (
            <ContactResult entry={row.entry} userId={userId} query={highlight} />
          ) : (
            <NoteResult node={row.node} query={noteQuery} />
          )}
        </CommandPrimitive.Item>
      ))}
      {group.hidden > 0 && (
        <CommandPrimitive.Item
          value={`more:${group.section}`}
          disabled={stale}
          onSelect={() => onExpand(group.section)}
          className={`${SEARCH_ITEM_CLASS} text-caption text-brand`}
        >
          {t(($) => $.search.show_all, { total: group.rows.length + group.hidden })}
        </CommandPrimitive.Item>
      )}
    </CommandPrimitive.Group>
  ));
}

function ChatResult({
  row,
  userId,
  query,
  stamp,
}: {
  row: Extract<SearchRow, { kind: "chat" }>;
  userId: string;
  query: string;
  stamp: string;
}) {
  return (
    <>
      <ChatAvatar chat={row.chat} userId={userId} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">
            <HighlightText text={row.title} query={query} />
          </span>
          <span className="shrink-0 text-micro text-muted-foreground tabular-nums">{stamp}</span>
        </span>
        {row.snippet && (
          <span className="block truncate text-caption text-muted-foreground">
            <HighlightText text={row.snippet} query={query} />
          </span>
        )}
      </span>
    </>
  );
}

function ContactResult({ entry, userId, query }: { entry: DirectoryEntry; userId: string; query: string }) {
  const { t } = useT("im");
  const self = entry.type === "member" && entry.id === userId;
  return (
    <>
      <ActorAvatar actorType={entry.type} actorId={entry.id} size="xl" profileLink={false} showStatusDot />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <HighlightText text={entry.name} query={query} />
        </span>
        {(self || entry.detail) && (
          <span className="block truncate text-caption text-muted-foreground">
            {self ? t(($) => $.contacts.you) : <HighlightText text={entry.detail} query={query} />}
          </span>
        )}
      </span>
      <span className="shrink-0 text-caption text-muted-foreground">
        {entry.type === "agent" ? t(($) => $.contacts.agent) : t(($) => $.contacts.person)}
      </span>
    </>
  );
}

function NoteResult({ node, query }: { node: DocNode; query: string }) {
  const dir = parentDir(node.path);
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">
          <HighlightText text={noteTitle(node.name)} query={query} />
        </span>
        {dir && <span className="max-w-[40%] shrink-0 truncate text-caption text-muted-foreground">{dir}</span>}
      </span>
      {node.snippet && (
        <span className="truncate pl-[26px] text-caption text-muted-foreground">
          <HighlightText text={node.snippet} query={query} />
        </span>
      )}
    </span>
  );
}
