/** Path of an open note after `from` is moved to `to`. Null when it is unaffected. */
export function relocatedDocPath(openPath: string, from: string, to: string): string | null {
  if (!from || !to || from === to) return null;
  if (openPath === from) return to;
  if (openPath.startsWith(`${from}/`)) return to + openPath.slice(from.length);
  return null;
}
