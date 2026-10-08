"use client";

import { Search } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import {
  SIDEBAR_WIDTH_DEFAULT,
  clampSidebarWidth,
  sidebarSplitWidth,
  sidebarWidthBounds,
  useSidebarWidth,
} from "@multica/ui/hooks/use-sidebar-width";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { ColumnResizeHandle } from "./resizable-column";

interface ImSidebarShellProps {
  className?: string;
  children: React.ReactNode;
}

/** Shares its width with the dashboard nav; phones keep the full-width list. */
export function ImSidebarShell({ className, children }: ImSidebarShellProps) {
  const { t } = useT("im");
  const isMobile = useIsMobile();
  const asideRef = useRef<HTMLElement>(null);
  const { width: preferred, commitWidth } = useSidebarWidth();
  const [split, setSplit] = useState(0);
  useLayoutEffect(() => {
    if (isMobile) return;
    const column = asideRef.current;
    if (!column) return;
    const measure = () => setSplit(sidebarSplitWidth(column));
    measure();
    const parent = column.parentElement;
    const observer = new ResizeObserver(measure);
    if (parent) observer.observe(parent);
    return () => observer.disconnect();
  }, [isMobile]);
  const bounds = sidebarWidthBounds(split);
  const width = clampSidebarWidth(preferred, split);
  // Until the row is measured, keep keyboard steps working. A real layout
  // replaces this with 3:7 and 7:3 before the user can drag.
  const options = {
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    min: bounds?.min ?? 1,
    max: bounds?.max ?? 100_000,
  };
  return (
    <aside
      ref={asideRef}
      className={cn("relative flex h-full shrink-0 flex-col border-r bg-sidebar", className)}
      style={isMobile ? undefined : { width }}
    >
      {children}
      {!isMobile && (
        <ColumnResizeHandle
          edge="right"
          width={width}
          options={options}
          onCommit={commitWidth}
          label={t(($) => $.sidebar.resize)}
        />
      )}
    </aside>
  );
}

interface ImSidebarHeaderProps {
  /** The tab name phones show centered above the search field. */
  title: string;
  /** Phones open the shared search page. */
  onOpenSearch?: () => void;
  /** Desktop field. Focusing it opens the shared search dropdown. */
  desktopSearch?: React.ReactNode;
  children?: React.ReactNode;
}

export function ImSidebarHeader({ title, onOpenSearch, desktopSearch, children }: ImSidebarHeaderProps) {
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
        {onOpenSearch && (
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-background text-label text-muted-foreground"
            >
              <Search className="size-[15px] shrink-0" />
              <span>{t(($) => $.sidebar.search)}</span>
            </button>
          </div>
        )}
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
        {desktopSearch}
        {children}
      </div>
    </div>
  );
}
