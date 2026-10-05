"use client";

import { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Loader2, Search, X } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspacePaths } from "@multica/core/paths";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { SearchResultGroups, SearchResultNotice } from "./im-search-results";
import type { SearchSection } from "./im-search-utils";
import { useImSearchGroups, type SearchRow } from "./use-im-search-groups";
import type { DirectoryEntry } from "./use-chat-directory";

const ALL_SECTIONS: SearchSection[] = ["chats", "contacts", "notes", "favorites"];

interface ImSidebarSearchProps {
  /** Which section leads the results. */
  priority: SearchSection;
  onOpenChat?: (chatId: string) => void;
  onOpenContact?: (entry: DirectoryEntry) => void;
  onOpenNote?: (path: string) => void;
  onOpenFavorite?: (id: string) => void;
}

/**
 * Desktop search field for chats, contacts, knowledge, and favorites. Focusing
 * it opens a dropdown of those four sections, without Ask AI. `priority` is
 * the section shown first.
 */
export function ImSidebarSearch({ priority, onOpenChat, onOpenContact, onOpenNote, onOpenFavorite }: ImSidebarSearchProps) {
  const { t } = useT("im");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<SearchSection>>(() => new Set());
  const [expandedFor, setExpandedFor] = useState(query);
  if (expandedFor !== query) {
    setExpandedFor(query);
    setExpanded(new Set());
  }
  const { searching, groups, stale, fetching, highlight, noteQuery, noteTruncated } = useImSearchGroups({
    open,
    query,
    sections: ALL_SECTIONS,
    priority,
    preview: true,
    expanded,
  });
  const label = t(($) => $.sidebar.search);
  const rowsKey = groups.flatMap((group) => group.rows.map((row) => row.value)).join("\n");

  useEffect(() => {
    setActive(stale ? "" : (rowsKey.split("\n")[0] ?? ""));
  }, [rowsKey, stale]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (row: SearchRow) => {
    close();
    if (row.kind === "chat") {
      if (onOpenChat) onOpenChat(row.chat.id);
      else navigation.push(paths.imChat(row.chat.id));
    } else if (row.kind === "contact") {
      if (onOpenContact) onOpenContact(row.entry);
      else navigation.push(paths.memberContact(row.entry.type, row.entry.id));
    } else if (row.kind === "note") {
      if (onOpenNote) onOpenNote(row.node.path);
      else navigation.push(paths.knowledgeFile(row.node.path));
    } else if (onOpenFavorite) {
      onOpenFavorite(row.id);
    } else {
      navigation.push(paths.collectItem(row.id));
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <CommandPrimitive
        shouldFilter={false}
        loop
        label={label}
        value={active}
        onValueChange={setActive}
        className="relative"
      >
        <div
          className={cn(
            "flex h-7 min-w-0 items-center gap-1.5 rounded-[7px] border border-transparent bg-background px-2 text-muted-foreground transition-colors focus-within:border-ring",
            open && "border-ring",
          )}
        >
          <Search className="size-[15px] shrink-0" />
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            placeholder={label}
            onValueChange={setQuery}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Home" || event.key === "End") event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                close();
                inputRef.current?.blur();
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-label text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t(($) => $.sidebar.clear_search)}
              className="flex shrink-0 rounded-sm hover:text-foreground"
            >
              <X className="size-[13px]" />
            </button>
          )}
        </div>
        {open && (
          <CommandPrimitive.List
            onMouseDown={(event) => event.preventDefault()}
            className="absolute top-full left-0 z-50 mt-1.5 max-h-[min(440px,55vh)] w-[calc(100%+2.25rem)] overflow-x-hidden overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-lg"
          >
            {groups.length > 0 ? (
              <SearchResultGroups
                groups={groups}
                stale={stale}
                highlight={highlight}
                noteQuery={noteQuery}
                userId={userId}
                onChoose={choose}
                onExpand={(section) => setExpanded((prev) => new Set(prev).add(section))}
              />
            ) : fetching || stale ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <SearchResultNotice>{searching ? t(($) => $.search.no_results) : t(($) => $.search.empty)}</SearchResultNotice>
            )}
            {noteTruncated && (
              <p className="px-5 pb-3 text-caption text-muted-foreground">{t(($) => $.knowledge.truncated)}</p>
            )}
          </CommandPrimitive.List>
        )}
      </CommandPrimitive>
    </div>
  );
}
