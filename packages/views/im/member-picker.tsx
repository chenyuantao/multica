"use client";

import { Check, Search } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { Input } from "@multica/ui/components/ui/input";
import { ActorAvatar } from "../common/actor-avatar";
import { useT } from "../i18n";
import { entryKey, matchesQuery, type DirectoryEntry } from "./use-chat-directory";

interface MemberPickerProps {
  people: DirectoryEntry[];
  agents: DirectoryEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  selected: Set<string>;
  onPick: (entry: DirectoryEntry) => void;
  disabled?: boolean;
}

/** Searchable list of people and agents; `selected` rows show a check. */
export function MemberPicker({ people, agents, query, onQueryChange, selected, onPick, disabled }: MemberPickerProps) {
  const { t } = useT("im");
  const groups = [
    { label: t(($) => $.add_member.people), entries: people.filter((e) => matchesQuery(e, query)) },
    { label: t(($) => $.add_member.agents), entries: agents.filter((e) => matchesQuery(e, query)) },
  ].filter((g) => g.entries.length > 0);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t(($) => $.add_member.search)}
          aria-label={t(($) => $.add_member.search)}
          className="pl-8"
        />
      </div>
      <div className="max-h-72 min-h-0 overflow-y-auto rounded-lg border">
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-body text-muted-foreground">{t(($) => $.add_member.empty)}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <p className="sticky top-0 bg-background px-3 pt-2 pb-1 text-caption font-medium text-muted-foreground">
                {group.label}
              </p>
              {group.entries.map((entry) => {
                const isSelected = selected.has(entryKey(entry.type, entry.id));
                return (
                  <button
                    key={entryKey(entry.type, entry.id)}
                    type="button"
                    disabled={disabled}
                    aria-pressed={isSelected}
                    onClick={() => onPick(entry)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50",
                      isSelected && "bg-accent/60",
                    )}
                  >
                    <ActorAvatar actorType={entry.type} actorId={entry.id} size="md" profileLink={false} showStatusDot />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body">{entry.name}</span>
                      {entry.detail && (
                        <span className="block truncate text-caption text-muted-foreground">{entry.detail}</span>
                      )}
                    </span>
                    {isSelected && <Check className="size-4 shrink-0 text-brand" />}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
