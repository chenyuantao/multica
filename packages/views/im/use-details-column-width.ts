"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { clampColumnRatio, columnRatioBounds, contentPairWidth } from "./column-ratio";
import { DETAILS_COLUMN_DEFAULT } from "./chat-panel-width";
import { useColumnWidth } from "./resizable-column";

/** Stored preference is not clipped to pixels. The visible width is the 3:7–7:3 clamp. */
const STORED_WIDTH = { defaultWidth: DETAILS_COLUMN_DEFAULT, min: 0, max: 100_000 };

/**
 * Width of the right details column. The limit is its share of the middle
 * content plus itself, from 3:7 to 7:3. The left list is not part of that pair.
 */
export function useDetailsColumnWidth(columnRef: RefObject<HTMLElement | null>) {
  const stored = useColumnWidth("details", STORED_WIDTH);
  const [pair, setPair] = useState(0);

  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const measure = () => setPair(contentPairWidth(column));
    measure();
    const observer = new ResizeObserver(measure);
    const parent = column.parentElement;
    const previous = column.previousElementSibling;
    if (parent) observer.observe(parent);
    if (previous) observer.observe(previous);
    return () => observer.disconnect();
  }, [columnRef]);

  const bounds = columnRatioBounds(pair);
  return {
    width: clampColumnRatio(stored.width, pair),
    commit: stored.commit,
    bounded: bounds != null,
    options: {
      defaultWidth: DETAILS_COLUMN_DEFAULT,
      min: bounds?.min ?? 1,
      max: bounds?.max ?? STORED_WIDTH.max,
    },
  };
}
