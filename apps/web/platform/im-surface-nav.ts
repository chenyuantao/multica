import { isImSurfaceLocalNav } from "@multica/core/paths";

export function hrefParts(href: string): { pathname: string; search: string } {
  const hash = href.indexOf("#");
  const withoutHash = hash === -1 ? href : href.slice(0, hash);
  const query = withoutHash.indexOf("?");
  return {
    pathname: query === -1 ? withoutHash : withoutHash.slice(0, query),
    search: query === -1 ? "" : withoutHash.slice(query + 1),
  };
}

/** Same-workspace IM tab: write the URL locally so Next does not fetch RSC. */
export function commitWebNavigation(
  href: string,
  fromPathname: string,
  router: { push: (path: string) => void; replace: (path: string) => void },
  mode: "push" | "replace",
  onLocal: (parts: { pathname: string; search: string }) => void,
): void {
  if (typeof window !== "undefined" && isImSurfaceLocalNav(fromPathname, href)) {
    if (mode === "replace") window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    onLocal(hrefParts(href));
    return;
  }
  if (mode === "replace") router.replace(href);
  else router.push(href);
}
