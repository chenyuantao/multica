"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@multica/ui/lib/utils";

const STORAGE_PREFIX = "multica:im-column-width:";
const DRAG_THRESHOLD = 3;
const KEYBOARD_STEP = 16;

export interface ColumnWidthOptions {
  defaultWidth: number;
  min: number;
  max: number;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clamp(width: number, { min, max }: ColumnWidthOptions) {
  return Math.max(min, Math.min(max, Math.round(width)));
}

/** Per-device column width, persisted once a drag or keyboard change settles. */
export function useColumnWidth(id: string, options: ColumnWidthOptions) {
  const { defaultWidth, min, max } = options;
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    const stored = Number(getStorage()?.getItem(STORAGE_PREFIX + id));
    if (stored && Number.isFinite(stored)) setWidth(clamp(stored, { defaultWidth, min, max }));
  }, [id, defaultWidth, min, max]);

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(next, { defaultWidth, min, max });
      setWidth(clamped);
      try {
        getStorage()?.setItem(STORAGE_PREFIX + id, String(clamped));
      } catch {
        // Storage full or disabled: the width still applies for this session.
      }
    },
    [id, defaultWidth, min, max],
  );

  return { width, commit, options };
}

interface ColumnResizeHandleProps {
  /** Which edge of the column the handle sits on. */
  edge: "left" | "right";
  width: number;
  options: ColumnWidthOptions;
  onCommit: (width: number) => void;
  label: string;
}

/**
 * Drag handle on a column edge. Mirrors the app sidebar rail: the column
 * width is previewed directly on the element during drag and committed to
 * state once on pointer-up.
 */
export function ColumnResizeHandle({ edge, width, options, onCommit, label }: ColumnResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    const handleEl = e.currentTarget;
    const columnEl = handleEl.parentElement;
    if (!columnEl) return;
    e.preventDefault();
    cancelRef.current?.();

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startWidth = columnEl.getBoundingClientRect().width;
    const direction = edge === "right" ? 1 : -1;
    let latest = startWidth;
    let moved = false;

    const finish = (mode: "commit" | "cancel") => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      document.documentElement.style.removeProperty("cursor");
      document.documentElement.style.removeProperty("user-select");
      cancelRef.current = null;
      setDragging(false);
      if (handleEl.hasPointerCapture?.(pointerId)) handleEl.releasePointerCapture?.(pointerId);
      if (mode === "commit" && moved) {
        onCommit(latest);
      } else {
        columnEl.style.width = `${width}px`;
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const delta = (event.clientX - startX) * direction;
      if (!moved && Math.abs(delta) < DRAG_THRESHOLD) return;
      moved = true;
      latest = clamp(startWidth + delta, options);
      columnEl.style.width = `${latest}px`;
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish("commit");
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish("cancel");
    };
    const onBlur = () => finish("cancel");

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    document.documentElement.style.cursor = "ew-resize";
    document.documentElement.style.userSelect = "none";
    cancelRef.current = () => finish("cancel");
    setDragging(true);
    handleEl.setPointerCapture?.(pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const grow = edge === "right" ? "ArrowRight" : "ArrowLeft";
    const shrink = edge === "right" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) onCommit(width + KEYBOARD_STEP);
    else if (e.key === shrink) onCommit(width - KEYBOARD_STEP);
    else if (e.key === "Home") onCommit(options.min);
    else if (e.key === "End") onCommit(options.max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={options.min}
      aria-valuemax={options.max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(options.defaultWidth)}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className={cn(
        "absolute inset-y-0 z-20 w-2 touch-none cursor-ew-resize outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:transition-colors",
        "hover:after:bg-border focus-visible:after:bg-ring data-dragging:after:bg-border",
        edge === "right" ? "-right-1" : "-left-1",
      )}
    />
  );
}
