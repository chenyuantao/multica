/**
 * Full-window IM tabs that can swap in the browser without asking Next for a
 * new RSC payload. Settings stays out: it lives in the dashboard layout.
 */
export const IM_SURFACE_SEGMENTS = ["im", "member", "knowledge", "reminder", "collect"] as const;

export type ImSurfaceSegment = (typeof IM_SURFACE_SEGMENTS)[number];

function pathOnly(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}

/** `im` / `member` / `knowledge` / `reminder` / `collect` on a workspace path, otherwise null. */
export function imSurfaceSegment(pathname: string): ImSurfaceSegment | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const segment = parts[1];
  return (IM_SURFACE_SEGMENTS as readonly string[]).includes(segment ?? "") ? (segment as ImSurfaceSegment) : null;
}

/**
 * True when both addresses are IM tabs in the same workspace, including a
 * query-only change on one tab (open a chat, open a saved message).
 */
export function isImSurfaceLocalNav(fromPathname: string, toHref: string): boolean {
  const toPathname = pathOnly(toHref);
  const fromSeg = imSurfaceSegment(fromPathname);
  const toSeg = imSurfaceSegment(toPathname);
  if (!fromSeg || !toSeg) return false;
  const fromSlug = fromPathname.split("/").filter(Boolean)[0];
  const toSlug = toPathname.split("/").filter(Boolean)[0];
  return Boolean(fromSlug && fromSlug === toSlug);
}
