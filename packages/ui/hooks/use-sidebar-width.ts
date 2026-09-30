"use client"

import * as React from "react"

export const SIDEBAR_WIDTH_DEFAULT = 256
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 480
const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar_width"

const listeners = new Set<() => void>()

export function clampSidebarWidth(width: number) {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(width)))
}

function readWidth() {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
    if (stored && Number.isFinite(stored)) return clampSidebarWidth(stored)
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
 */
export function useSidebarWidth() {
  const width = React.useSyncExternalStore(subscribe, readWidth, () => SIDEBAR_WIDTH_DEFAULT)
  const commitWidth = React.useCallback((next: number) => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(next)))
    } catch {
      return
    }
    for (const listener of listeners) listener()
  }, [])
  return { width, commitWidth }
}
