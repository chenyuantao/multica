/**
 * Route gate for the floating chat overlay, shared by the overlay itself and by
 * the `toggleChat` keyboard shortcut so the two can never disagree.
 *
 * On the Chat tab the full-page surface already owns the same `activeSessionId`,
 * so a floating copy would be pure duplication; Settings keeps its full width
 * free of the launcher. `FloatingChat` renders nothing on these routes. The
 * shortcut has to honour the same rule: flipping `isOpen` on a route where the
 * overlay cannot mount reads as a dead keypress, and then surprises the user
 * with a window that pops open (or vanishes) on the next navigation.
 */
export function isFloatingChatRouteSuppressed(
  pathname: string,
  suppressedPaths: readonly string[],
): boolean {
  return suppressedPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
