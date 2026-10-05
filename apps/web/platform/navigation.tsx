"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { imSurfaceSegment } from "@multica/core/paths";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "@multica/views/navigation";
import { canGoBackInApp } from "./in-app-history";
import { commitWebNavigation } from "./im-surface-nav";

/**
 * Web half of the `multica:navigate` bridge — the event shared content
 * (comments, chat, issue descriptions) fires when a link resolves to an in-app
 * destination. A plain click ("push") is a router push in place. A modifier
 * click normally never reaches here on web — real anchors leave it to the
 * browser — but the editor must intercept every click (contenteditable
 * anchors don't navigate natively), and for those `window.open` is the
 * closest the web can get: JS cannot open a background tab, so both tab
 * dispositions land as a foreground browser tab.
 */
function useInternalLinkHandler(go: (path: string) => void) {
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ path?: string; disposition?: string }>
      ).detail;
      const path = detail?.path;
      if (!path) return;
      if (
        detail?.disposition === "background-tab" ||
        detail?.disposition === "foreground-tab"
      ) {
        window.open(
          window.location.origin + path,
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }
      goRef.current(path);
    };
    window.addEventListener("multica:navigate", handler);
    return () => window.removeEventListener("multica:navigate", handler);
  }, []);
}

/**
 * The fragment is client-only state Next.js never surfaces: `usePathname()`
 * drops it, and a `router.replace("/x#y")` mutates `window.location` without
 * a render of its own. Reading it through an external store re-reads the URL
 * on every render and re-renders on the events that change it behind React's
 * back, so `adapter.hash` is never a stale copy.
 */
function subscribeToHash(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener("hashchange", onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

function searchFromWindow(): string {
  const search = window.location.search;
  return search.startsWith("?") ? search.slice(1) : search;
}

function NavigationProviderInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const routerPathname = usePathname();
  const routerSearchParams = useSearchParams();
  const routerSearch = routerSearchParams.toString();
  const [soft, setSoft] = useState<{ pathname: string; search: string } | null>(null);
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => "",
  );

  useEffect(() => {
    if (!soft) return;
    if (routerPathname === soft.pathname && routerSearch === soft.search) setSoft(null);
  }, [routerPathname, routerSearch, soft]);

  useEffect(() => {
    const onPop = () => {
      const pathname = window.location.pathname;
      if (imSurfaceSegment(pathname)) setSoft({ pathname, search: searchFromWindow() });
      else setSoft(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const pathname = soft?.pathname ?? routerPathname;
  const search = soft?.search ?? routerSearch;

  const go = (path: string, mode: "push" | "replace") => {
    commitWebNavigation(path, pathname, router, mode, setSoft);
  };
  useInternalLinkHandler((path) => go(path, "push"));

  const adapter: NavigationAdapter = {
    push: (path: string) => go(path, "push"),
    replace: (path: string) => go(path, "replace"),
    back: router.back,
    forward: router.forward,
    canGoBack: canGoBackInApp,
    pathname,
    searchParams: new URLSearchParams(search),
    hash,
    getShareableUrl: (path: string) =>
      typeof window === "undefined" ? path : window.location.origin + path,
    // router.prefetch is a no-op in dev mode by Next.js design; in production
    // it warms the RSC payload + route chunk so the next push() commits with
    // no network round-trip. Safe to call repeatedly — Next dedupes internally.
    prefetch: (path: string) => {
      router.prefetch(path);
    },
  };

  return <NavigationProvider value={adapter}>{children}</NavigationProvider>;
}

export function WebNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense>
      <NavigationProviderInner>{children}</NavigationProviderInner>
    </Suspense>
  );
}
