/**
 * Which reminder conversation this workspace has open on the desktop page.
 * Absence means the page has not chosen yet. `null` means the user closed it.
 * Kept in memory for the tab, so leaving and returning does not start over.
 */
const openByWorkspace = new Map<string, string | null>();

export function reminderOpenId(wsId: string): string | null | undefined {
  return openByWorkspace.has(wsId) ? openByWorkspace.get(wsId)! : undefined;
}

export function rememberReminderOpen(wsId: string, id: string | null): void {
  openByWorkspace.set(wsId, id);
}

export function resetReminderOpenMemory(): void {
  openByWorkspace.clear();
}
