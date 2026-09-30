import * as React from "react"

const MOBILE_BREAKPOINT = 768
// Tailwind `lg`. Below it a 256px nav plus a 320px list column leave a
// list/detail surface only a couple hundred pixels of reading width, so those
// surfaces fold to the single column phones already get.
const COMPACT_BREAKPOINT = 1024

function queryFor(breakpoint: number) {
  return `(max-width: ${breakpoint - 1}px)`
}

function subscribeTo(breakpoint: number) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(queryFor(breakpoint))
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }
}

const subscribeMobile = subscribeTo(MOBILE_BREAKPOINT)
const subscribeCompact = subscribeTo(COMPACT_BREAKPOINT)
const getServerSnapshot = () => false

// Read synchronously on the client so a freshly mounted page lays out for the
// current width on its first frame instead of flashing the wide layout.
function useIsBelow(breakpoint: number, subscribe: (onChange: () => void) => () => void) {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < breakpoint,
    getServerSnapshot,
  )
}

export function useIsMobile() {
  return useIsBelow(MOBILE_BREAKPOINT, subscribeMobile)
}

export function useIsCompact() {
  return useIsBelow(COMPACT_BREAKPOINT, subscribeCompact)
}
