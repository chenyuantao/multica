/** Narrowest right-sidebar:middle split. */
export const COLUMN_MIN_RATIO = 3 / 10;
/** Widest right-sidebar:middle split. */
export const COLUMN_MAX_RATIO = 7 / 10;

/** Pixel limits for a trailing column sharing `pairWidth` with the middle content. */
export function columnRatioBounds(pairWidth: number): { min: number; max: number } | null {
  if (!Number.isFinite(pairWidth) || pairWidth <= 0) return null;
  const min = Math.round(pairWidth * COLUMN_MIN_RATIO);
  const max = Math.round(pairWidth * COLUMN_MAX_RATIO);
  return max < min ? { min: max, max: min } : { min, max };
}

/** Clamp to 3:7–7:3 when the pair has been measured. An unmeasured pair keeps `width`. */
export function clampColumnRatio(width: number, pairWidth: number): number {
  const rounded = Math.round(width);
  if (!Number.isFinite(rounded)) return rounded;
  const bounds = columnRatioBounds(pairWidth);
  if (!bounds) return rounded;
  return Math.max(bounds.min, Math.min(bounds.max, rounded));
}

/**
 * Width of the middle column plus this trailing sidebar.
 * The sibling immediately before the sidebar is the middle; a leading list is not included.
 */
export function contentPairWidth(column: HTMLElement): number {
  const own = column.getBoundingClientRect().width;
  const previous = column.previousElementSibling;
  if (previous instanceof HTMLElement) {
    const pair = previous.getBoundingClientRect().width + own;
    return pair > 0 ? pair : 0;
  }
  const parent = column.parentElement?.getBoundingClientRect().width ?? 0;
  return parent > 0 ? parent : 0;
}
