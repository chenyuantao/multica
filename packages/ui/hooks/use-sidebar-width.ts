"use client"

import * as React from "react"

export const SIDEBAR_WIDTH_DEFAULT = 256
/** Narrowest sidebar:content split. */
export const SIDEBAR_WIDTH_MIN_RATIO = 3 / 10
/** Widest sidebar:content split. */
export const SIDEBAR_WIDTH_MAX_RATIO = 7 / 10
const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar_width"

const listeners = new Set<() => void>()

/**
 * Pixel limits for a sidebar sharing `splitWidth` with the content beside it.
 * `splitWidth` is that pair only: a leading icon rail is not part of the ratio.
 * Returns null until the row has been measured.
 */
export function sidebarWidthBounds(splitWidth: number): { min: number; max: number } | null {
  if (!Number.isFinite(splitWidth) || splitWidth <= 0) return null
  const min = Math.round(splitWidth * SIDEBAR_WIDTH_MIN_RATIO)
  const max = Math.round(splitWidth * SIDEBAR_WIDTH_MAX_RATIO)
  return max < min ? { min: max, max: min } : { min, max }
}

/** Clamp to 3:7–7:3 when the row width is known. An unmeasured row keeps `width`. */
export function clampSidebarWidth(width: number, splitWidth: number) {
  const rounded = Math.round(width)
  if (!Number.isFinite(rounded)) return SIDEBAR_WIDTH_DEFAULT
  const bounds = sidebarWidthBounds(splitWidth)
  if (!bounds) return rounded
  return Math.max(bounds.min, Math.min(bounds.max, rounded))
}

/**
 * Width of the row `column` splits with everything after it.
 * `boundary` defaults to the parent. Pass the full shell when the column's
 * parent is only as wide as the column itself, as the dashboard sidebar group is.
 */
export function sidebarSplitWidth(column: HTMLElement, boundary?: HTMLElement | null) {
  const parent = boundary ?? column.parentElement
  if (!parent) return 0
  const parentRect = parent.getBoundingClientRect()
  const leading = Math.max(0, column.getBoundingClientRect().left - parentRect.left)
  const split = parentRect.width - leading
  return split > 0 ? split : 0
}

function readWidth() {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
    if (stored && Number.isFinite(stored)) return stored
  } catch {
    // Storage disabled: fall through to the default.
  }
  return SIDEBAR_WIDTH_DEFAULT
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIDEBAR_WIDTH_STORAGE_KEY || e.key === null) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/**
 * The one left-column width shared by every primary sidebar (the dashboard
 * nav and the IM section lists), so resizing any of them resizes them all.
 * The stored number is a pixel preference. Each surface clamps it to between
 * 3:7 and 7:3 of the row it shares with the content.
 */
export function useSidebarWidth() {
  const width = React.useSyncExternalStore(subscribe, readWidth, () => SIDEBAR_WIDTH_DEFAULT)
  const commitWidth = React.useCallback((next: number) => {
    const rounded = Math.round(next)
    if (!Number.isFinite(rounded)) return
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(rounded))
    } catch {
      return
    }
    for (const listener of listeners) listener()
  }, [])
  return { width, commitWidth }
}
