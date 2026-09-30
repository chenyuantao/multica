"use client";

import { useState } from "react";
import type { TFunction } from "i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CirclePlus, FileText, Folder, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { errorCode } from "@multica/core/api";
import { docsSearchOptions, docsTreeOptions } from "@multica/core/docs";
import type { DocNode } from "@multica/core/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { copyText } from "@multica/ui/lib/clipboard";
import { cn } from "@multica/ui/lib/utils";
import { useDebouncedValue } from "../common/use-debounced-value";
import { useLocale, useT } from "../i18n";
import { formatClock, isSameDay } from "./im-utils";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";
import { ancestorDirs, parentDir } from "./knowledge-utils";

const EMPTY_NODES: DocNode[] = [];

interface KnowledgeSidebarProps {
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Opens note creation inside `dir` ("" is the vault root). */
  onCreate: (dir: string) => void;
  className?: string;
}

export function KnowledgeSidebar({ selectedPath, onSelect, onCreate, className }: KnowledgeSidebarProps) {
  const { t } = useT("im");
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 250);
  const searching = q.length > 0;
  const tree = useQuery(docsTreeOptions());
  const search = useQuery(docsSearchOptions(q));
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());

  const nodes = (searching ? search.data?.nodes : tree.data) ?? EMPTY_NODES;
  const active = searching ? search : tree;
  // Top-level folders and the open note's folders start expanded; a click
  // overrides either way. Search results are always fully expanded.
  const selectedDirs = new Set(selectedPath ? ancestorDirs(selectedPath) : []);
  const isOpen = (node: DocNode, depth: number) =>
    searching || (toggled.get(node.path) ?? (depth === 0 || selectedDirs.has(node.path)));
  const toggle = (path: string, open: boolean) =>
    setToggled((prev) => new Map(prev).set(path, !open));

  const createTarget = selectedPath ? parentDir(selectedPath) : "";

  return (
    <ImSidebarShell className={className}>
      <ImSidebarHeader query={query} onQueryChange={setQuery} searchLabel={t(($) => $.knowledge.search)}>
        <button
          type="button"
          onClick={() => onCreate(createTarget)}
          aria-label={t(($) => $.knowledge.new_note)}
          title={t(($) => $.knowledge.new_note)}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <CirclePlus className="size-[21px]" strokeWidth={1.7} />
        </button>
      </ImSidebarHeader>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3" aria-label={t(($) => $.rail.knowledge)}>
        {active.isError ? (
          <SidebarNotice>{loadErrorText(active.error, t)}</SidebarNotice>
        ) : active.isPending && (searching || !tree.data) ? null : nodes.length === 0 ? (
          <SidebarNotice>{searching ? t(($) => $.knowledge.no_results) : t(($) => $.knowledge.empty)}</SidebarNotice>
        ) : (
          <ul className="flex flex-col">
            {nodes.map((node) => (
              <li key={node.path} className="border-b border-foreground/5 py-1 last:border-b-0">
                <TreeNode
                  node={node}
                  depth={0}
                  isOpen={isOpen}
                  selectedPath={selectedPath}
                  onToggle={toggle}
                  onSelect={onSelect}
                  onCreate={onCreate}
                />
              </li>
            ))}
          </ul>
        )}
        {searching && search.data?.truncated && (
          <p className="px-3 pt-2 text-caption text-muted-foreground">{t(($) => $.knowledge.truncated)}</p>
        )}
      </nav>
    </ImSidebarShell>
  );
}

type Translate = TFunction<"im">;

export function loadErrorText(error: unknown, t: Translate): string {
  switch (errorCode(error)) {
    case "obsidian_vault_unconfigured":
      return t(($) => $.knowledge.unconfigured);
    case "obsidian_vault_unavailable":
      return t(($) => $.knowledge.unavailable);
    default:
      return t(($) => $.knowledge.load_failed);
  }
}

function SidebarNotice({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-8 text-center text-body text-muted-foreground">{children}</p>;
}

interface TreeNodeProps {
  node: DocNode;
  depth: number;
  isOpen: (node: DocNode, depth: number) => boolean;
  selectedPath: string | null;
  onToggle: (path: string, open: boolean) => void;
  onSelect: (path: string) => void;
  onCreate: (dir: string) => void;
}

const rowClass =
  "group/row flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset";

function TreeNode(props: TreeNodeProps) {
  const { node, depth, isOpen, selectedPath, onToggle, onSelect, onCreate } = props;
  const { t } = useT("im");

  if (node.type === "file") {
    const selected = node.path === selectedPath;
    return (
      <div className={cn(rowClass, "relative", selected ? "bg-brand/12 hover:bg-brand/12" : "hover:bg-foreground/5")}>
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          aria-current={selected ? "page" : undefined}
          title={node.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          <span className="size-4 shrink-0" />
          <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-body", selected && "font-medium")}>{node.name}</span>
            {node.snippet && <span className="block truncate text-caption text-muted-foreground">{node.snippet}</span>}
          </span>
          {node.modified_at && <DocStamp iso={node.modified_at} />}
        </button>
        <RowMenu
          label={t(($) => $.knowledge.more, { name: node.name })}
          items={[
            { label: t(($) => $.knowledge.new_note_here), onSelect: () => onCreate(parentDir(node.path)) },
            { label: t(($) => $.knowledge.copy_path), onSelect: () => void copyPath(node.path, t) },
          ]}
        />
      </div>
    );
  }

  const open = isOpen(node, depth);
  return (
    <>
      <div className={cn(rowClass, "relative hover:bg-foreground/5")}>
        <button
          type="button"
          onClick={() => onToggle(node.path, open)}
          aria-expanded={open}
          title={node.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
          <span className={cn("min-w-0 truncate text-body", depth === 0 && "font-medium")}>{node.name}</span>
          <span className="shrink-0 text-caption text-muted-foreground tabular-nums">({node.child_count})</span>
        </button>
        <RowMenu
          label={t(($) => $.knowledge.more, { name: node.name })}
          items={[
            { label: t(($) => $.knowledge.new_note_here), onSelect: () => onCreate(node.path) },
            { label: t(($) => $.knowledge.copy_path), onSelect: () => void copyPath(node.path, t) },
          ]}
        />
      </div>
      {open && node.children.length > 0 && (
        // The dashed guide sits under this row's chevron (8px padding + half of 16px).
        <ul className="ml-[15.5px] flex flex-col border-l border-dashed border-border pl-1">
          {node.children.map((child) => (
            <li key={child.path}>
              <TreeNode {...props} node={child} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

async function copyPath(path: string, t: Translate) {
  if (await copyText(path)) toast.success(t(($) => $.knowledge.path_copied));
}

function RowMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-foreground/5 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[popup-open]:opacity-100"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onClick={item.onSelect}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocStamp({ iso }: { iso: string }) {
  const { t } = useT("im");
  const { t: tc } = useT("common");
  const locale = useLocale();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const text = isSameDay(d, now)
    ? formatClock(iso, locale)
    : isSameDay(d, yesterday)
      ? t(($) => $.thread.yesterday, { time: formatClock(iso, locale) })
      : days < 7
        ? tc(($) => $.time.days_ago, { count: Math.max(days, 2) })
        : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{text}</span>;
}
