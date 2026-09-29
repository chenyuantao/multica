"use client";

import { Search, X } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { DragStrip } from "../platform";

export function ImSidebarShell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <aside className={cn("flex h-full w-64 shrink-0 flex-col border-r bg-sidebar", className)}>{children}</aside>;
}

interface ImSidebarHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  searchLabel: string;
  children?: React.ReactNode;
}

export function ImSidebarHeader({ query, onQueryChange, searchLabel, children }: ImSidebarHeaderProps) {
  const { t } = useT("im");
  return (
    <div className="relative flex h-[58px] shrink-0 items-center px-3">
      <div className="absolute inset-0">
        <DragStrip />
      </div>
      <div
        className="relative flex min-w-0 flex-1 items-center gap-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border border-transparent bg-background px-2 text-muted-foreground transition-colors focus-within:border-ring">
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
        {children}
      </div>
    </div>
  );
}
