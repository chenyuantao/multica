"use client";

import { Search, X } from "lucide-react";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useSidebarWidth,
} from "@multica/ui/hooks/use-sidebar-width";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { ColumnResizeHandle } from "./resizable-column";

const WIDTH_OPTIONS = { defaultWidth: SIDEBAR_WIDTH_DEFAULT, min: SIDEBAR_WIDTH_MIN, max: SIDEBAR_WIDTH_MAX };

interface ImSidebarShellProps {
  className?: string;
  children: React.ReactNode;
}

/** Shares its width with the dashboard nav; phones keep the full-width list. */
export function ImSidebarShell({ className, children }: ImSidebarShellProps) {
  const { t } = useT("im");
  const isMobile = useIsMobile();
  const { width, commitWidth } = useSidebarWidth();
  return (
    <aside
      className={cn("relative flex h-full shrink-0 flex-col border-r bg-sidebar", className)}
      style={isMobile ? undefined : { width }}
    >
      {children}
      {!isMobile && (
        <ColumnResizeHandle
          edge="right"
          width={width}
          options={WIDTH_OPTIONS}
          onCommit={commitWidth}
          label={t(($) => $.sidebar.resize)}
        />
      )}
    </aside>
  );
}

interface ImSidebarHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  searchLabel: string;
  /** The tab name phones show centered above the search field. */
  title: string;
  /** Phones open the shared search page instead of filtering this list. */
  onOpenSearch?: () => void;
  children?: React.ReactNode;
}

export function ImSidebarHeader({ query, onQueryChange, searchLabel, title, onOpenSearch, children }: ImSidebarHeaderProps) {
  const { t } = useT("im");
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="shrink-0">
        <div className="grid h-12 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center px-1">
          <span />
          <h1 className="truncate text-center text-body-lg font-semibold">{title}</h1>
          <div className="flex justify-center">{children}</div>
        </div>
        <div className="px-3 pb-2">
          {onOpenSearch ? (
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-background text-label text-muted-foreground"
            >
              <Search className="size-[15px] shrink-0" />
              <span>{t(($) => $.sidebar.search)}</span>
            </button>
          ) : (
            <SearchField query={query} onQueryChange={onQueryChange} searchLabel={searchLabel} className="h-8" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-[58px] shrink-0 items-center px-3">
      <div className="absolute inset-0">
        <DragStrip />
      </div>
      <div
        className="relative flex min-w-0 flex-1 items-center gap-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <SearchField query={query} onQueryChange={onQueryChange} searchLabel={searchLabel} className="h-7" />
        {children}
      </div>
    </div>
  );
}

function SearchField({
  query,
  onQueryChange,
  searchLabel,
  className,
}: Pick<ImSidebarHeaderProps, "query" | "onQueryChange" | "searchLabel"> & { className?: string }) {
  const { t } = useT("im");
  return (
    <label
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border border-transparent bg-background px-2 text-muted-foreground transition-colors focus-within:border-ring",
        className,
      )}
    >
      <Search className="size-[15px] shrink-0" />
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={searchLabel}
        aria-label={searchLabel}
        className="min-w-0 flex-1 bg-transparent text-label text-foreground outline-none placeholder:text-muted-foreground"
      />
      {query && (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          aria-label={t(($) => $.sidebar.clear_search)}
          className="flex shrink-0 rounded-sm hover:text-foreground"
        >
          <X className="size-[13px]" />
        </button>
      )}
    </label>
  );
}
