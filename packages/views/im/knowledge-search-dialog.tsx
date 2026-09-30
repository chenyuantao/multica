"use client";

import { useEffect, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileText, Loader2, SearchIcon } from "lucide-react";
import { docsSearchOptions, docsTreeOptions } from "@multica/core/docs";
import type { DocNode } from "@multica/core/types";
import {
  createShortcutChord,
  getShortcut,
  isPortalLayerShortcutTarget,
  shortcutMatchesEvent,
} from "@multica/core/shortcuts";
import { isImeComposing } from "@multica/core/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";
import { useDebouncedValue } from "../common/use-debounced-value";
import { useT } from "../i18n";
import { HighlightText } from "../search/highlight-text";
import { loadErrorText } from "./knowledge-sidebar";
import { flattenFiles, noteTitle, parentDir, recentFiles } from "./knowledge-utils";

const RECENT_LIMIT = 20;
const EMPTY_NODES: DocNode[] = [];

const GROUP_CLASS =
  "p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

interface KnowledgeSearchDialogProps {
  onSelect: (path: string) => void;
}

/**
 * Quick switcher for the knowledge base, opened with the `openKnowledgeSearch`
 * shortcut (Mod+O). Hits are listed flat — one row per note — rather than as
 * the sidebar's folder tree, so arrow keys walk straight through them.
 */
export function KnowledgeSearchDialog({ onSelect }: KnowledgeSearchDialogProps) {
  const { t } = useT("im");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const trimmed = query.trim();
  const q = useDebouncedValue(trimmed, 200);
  const searching = trimmed.length > 0;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isImeComposing(e)) return;
      if (!shortcutMatchesEvent(getShortcut("openKnowledgeSearch"), e)) return;
      // Another dialog or menu owns the keyboard; only our own may be toggled.
      if (!open && isPortalLayerShortcutTarget(e.target)) return;
      e.preventDefault();
      setOpen(!open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const tree = useQuery({ ...docsTreeOptions(), enabled: open });
  // Previous hits stay painted while the next keyword is in flight so the
  // list does not strobe on every keystroke.
  const search = useQuery({ ...docsSearchOptions(q), enabled: open && q.length > 0, placeholderData: keepPreviousData });

  const rows = searching
    ? flattenFiles(search.data?.nodes ?? EMPTY_NODES)
    : recentFiles(tree.data ?? EMPTY_NODES, RECENT_LIMIT);
  // Rows answering an earlier keyword must not be actionable, or Enter would
  // jump to a note the user has already typed past.
  const stale = searching && (q !== trimmed || search.isPlaceholderData);
  const current = searching ? search : tree;
  const rowsKey = rows.map((row) => row.path).join("\n");

  useEffect(() => {
    setActive(stale ? "" : (rowsKey.split("\n")[0] ?? ""));
  }, [rowsKey, stale]);

  const choose = (path: string) => {
    setOpen(false);
    onSelect(path);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[20%] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl!"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t(($) => $.knowledge.search)}</DialogTitle>
        </DialogHeader>
        <CommandPrimitive
          shouldFilter={false}
          loop
          value={active}
          onValueChange={setActive}
          className="flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground"
        >
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              placeholder={t(($) => $.knowledge.search)}
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                // cmdk's root handler intercepts Home/End for list navigation;
                // stop propagation so the browser moves the text caret instead.
                if (e.key === "Home" || e.key === "End") e.stopPropagation();
              }}
              className="flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
            />
            <ShortcutKeycaps shortcut={createShortcutChord("Escape")} className="hidden shrink-0 sm:inline-flex" />
          </div>

          <CommandPrimitive.List className="max-h-[min(400px,50vh)] overflow-x-hidden overflow-y-auto">
            {current.isError ? (
              <Notice>{loadErrorText(current.error, t)}</Notice>
            ) : rows.length > 0 ? (
              <CommandPrimitive.Group
                heading={searching ? undefined : t(($) => $.knowledge.recent)}
                className={GROUP_CLASS}
              >
                {rows.map((node) => (
                  <ResultRow
                    key={node.path}
                    node={node}
                    query={searching ? (search.data?.query ?? "") : ""}
                    disabled={stale}
                    onSelect={choose}
                  />
                ))}
              </CommandPrimitive.Group>
            ) : current.isFetching || stale ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Notice>{searching ? t(($) => $.knowledge.no_results) : t(($) => $.knowledge.empty)}</Notice>
            )}
            {searching && !stale && search.data?.truncated && (
              <p className="px-5 pb-3 text-caption text-muted-foreground">{t(($) => $.knowledge.truncated)}</p>
            )}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-body text-muted-foreground">{children}</p>;
}

function ResultRow({
  node,
  query,
  disabled,
  onSelect,
}: {
  node: DocNode;
  query: string;
  disabled: boolean;
  onSelect: (path: string) => void;
}) {
  const dir = parentDir(node.path);
  return (
    <CommandPrimitive.Item
      value={node.path}
      disabled={disabled}
      onSelect={() => onSelect(node.path)}
      title={node.path}
      className="flex cursor-default flex-col gap-0.5 rounded-lg px-3 py-2 text-body outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">
          <HighlightText text={noteTitle(node.name)} query={query} />
        </span>
        {dir && <span className="max-w-[40%] shrink-0 truncate text-caption text-muted-foreground">{dir}</span>}
      </div>
      {node.snippet && (
        <span className="truncate pl-[26px] text-caption text-muted-foreground">
          <HighlightText text={node.snippet} query={query} />
        </span>
      )}
    </CommandPrimitive.Item>
  );
}
