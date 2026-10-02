import { ApiError, getApi } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { isPwaOfflinePath, PWA_READ_CACHE, PWA_SHELL_CACHE } from "./pwa-offline-path";

/**
 * Read-through Cache Storage for the offline pages.
 *
 * Each successful query result is stored. The next time that query fetches
 * with nothing in memory, the stored result is shown immediately and the
 * request still goes to the network; the network result replaces both the
 * screen and the stored copy. A transport failure keeps the stored result
 * on screen so the page can be read offline. A 4xx is the server's answer
 * and is left alone.
 *
 * Identity (`GET /api/me`) is not a React Query, but the workspace layout
 * will not render until it resolves, so it uses the same race.
 */

const ME_ENTRY = "__me__";

interface CacheDeps {
  getPathname: () => string;
  getUserId: () => string | null;
}

let epoch = 0;
const writeTails = new Map<string, Promise<void>>();

function origin(): string {
  if (typeof location !== "undefined" && location.origin) return location.origin;
  return "http://localhost";
}

function entryUrl(id: string): string {
  const url = new URL("/__pwa_read__", origin());
  url.searchParams.set("id", id);
  return url.href;
}

async function openReadCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(PWA_READ_CACHE);
  } catch {
    return null;
  }
}

async function readEntry(id: string): Promise<unknown | undefined> {
  const cache = await openReadCache();
  if (!cache) return undefined;
  const hit = await cache.match(entryUrl(id));
  if (!hit) return undefined;
  try {
    const body = await hit.json() as { data?: unknown };
    if (!body || typeof body !== "object" || !("data" in body)) return undefined;
    return body.data;
  } catch {
    return undefined;
  }
}

function enqueueWrite(id: string, data: unknown): void {
  let body: string;
  try {
    body = JSON.stringify({ v: 1, data });
  } catch {
    return;
  }
  const token = epoch;
  const prev = writeTails.get(id) ?? Promise.resolve();
  const next = prev.then(() => putBody(id, body, token), () => putBody(id, body, token));
  writeTails.set(id, next.then(() => undefined, () => undefined));
}

async function putBody(id: string, body: string, token: number): Promise<void> {
  if (token !== epoch) return;
  const cache = await openReadCache();
  if (!cache || token !== epoch) return;
  await cache.put(entryUrl(id), new Response(body, {
    headers: { "Content-Type": "application/json" },
  }));
}

/** Test helper: wait until queued cache writes have landed. */
export function flushPwaReadCache(): Promise<void> {
  return Promise.all([...writeTails.values()]).then(() => undefined);
}

export async function clearPwaCaches(): Promise<void> {
  epoch += 1;
  writeTails.clear();
  if (typeof caches === "undefined") return;
  await Promise.all([
    caches.delete(PWA_READ_CACHE).catch(() => false),
    caches.delete(PWA_SHELL_CACHE).catch(() => false),
  ]);
}

function defaultPathname(): string {
  if (typeof location === "undefined") return "";
  return location.pathname;
}

function defaultUserId(): string | null {
  try {
    return useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

function keepStale(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  if ((error as { name?: string }).name === "CancelledError") return false;
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}

function onQueryEvent(
  queryClient: QueryClient,
  event: { type: string; query?: Query; action?: { type: string; data?: unknown; error?: unknown } },
  getPathname: () => string,
  getUserId: () => string | null,
): void {
  if (event.type !== "updated" || !event.query || !event.action) return;
  if (!isPwaOfflinePath(getPathname())) return;
  const userId = getUserId();
  if (!userId) return;

  const query = event.query;
  const action = event.action;
  const id = `${userId}:${query.queryHash}`;

  if (action.type === "fetch" && query.state.data === undefined) {
    void readEntry(id).then((cached) => {
      if (cached === undefined) return;
      if (query.state.data !== undefined) return;
      if (!keepStale(query.state.error)) return;
      queryClient.setQueryData(query.queryKey as QueryKey, cached);
    });
  }

  if (action.type === "success" && action.data !== undefined) {
    enqueueWrite(id, action.data);
  }

  if (action.type === "error" && query.state.data !== undefined && keepStale(action.error)) {
    queueMicrotask(() => {
      if (query.state.data === undefined || !keepStale(query.state.error ?? action.error)) return;
      query.setState({
        status: "success",
        error: null,
        fetchStatus: "idle",
        isInvalidated: false,
      });
    });
  }
}

/**
 * Cache-then-network. With a stored value, the caller receives it now and
 * `publish` receives the network value later. Without one, the caller waits
 * for the network. A network failure after a cache hit does not reject the
 * caller; `onTransportError` sees it.
 */
export async function raceCachedRead<T>(options: {
  enabled: boolean;
  read: () => Promise<T | undefined>;
  load: () => Promise<T>;
  write: (value: T) => Promise<void> | void;
  publish: (value: T) => void;
  onTransportError?: (error: unknown) => void;
}): Promise<T> {
  if (!options.enabled) return options.load();
  const cached = await options.read().catch(() => undefined);
  const pending = options.load().then(async (value) => {
    await options.write(value);
    return value;
  });
  if (cached === undefined) return pending;
  void pending.then((value) => options.publish(value)).catch((error: unknown) => {
    options.onTransportError?.(error);
  });
  return cached;
}

const PATCHED = Symbol.for("multica.pwaGetMe");

function installGetMeRace(): void {
  let api: ReturnType<typeof getApi>;
  try {
    api = getApi();
  } catch {
    return;
  }
  const target = api as typeof api & { [PATCHED]?: true };
  if (target[PATCHED]) return;
  const original = api.getMe.bind(api);
  api.getMe = () => raceCachedRead({
    enabled: isPwaOfflinePath(defaultPathname()),
    read: () => readEntry(ME_ENTRY) as Promise<Awaited<ReturnType<typeof original>> | undefined>,
    load: () => original(),
    write: (user) => {
      enqueueWrite(ME_ENTRY, user);
    },
    publish: (user) => {
      try {
        const state = useAuthStore.getState();
        if (state.status === "unauthenticated") return;
        useAuthStore.setState({
          user,
          isLoading: false,
          status: "authenticated",
          expired: false,
        });
      } catch {
        // Auth store is not up yet. The caller already has the cached user.
      }
    },
    onTransportError: (error) => {
      if (!(error instanceof ApiError) || error.status !== 401) return;
      try {
        useAuthStore.getState().sessionExpired();
      } catch {
        // Nothing to sign out of.
      }
    },
  });
  target[PATCHED] = true;
}

export function attachPwaReadCache(
  queryClient: QueryClient,
  override?: Partial<CacheDeps> & { patchGetMe?: boolean },
): () => void {
  if (override?.patchGetMe !== false) installGetMeRace();
  const getPathname = override?.getPathname ?? defaultPathname;
  const getUserId = override?.getUserId ?? defaultUserId;
  return queryClient.getQueryCache().subscribe((event) => {
    onQueryEvent(queryClient, event, getPathname, getUserId);
  });
}

export async function registerPwaServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // The push setting registers the same script. Failing here only means
    // this visit will not fill the offline shell.
  }
}

const warmedPaths = new Set<string>();

/** Pull the current document and its static assets through the worker once. */
export async function warmPwaShell(pathname: string): Promise<void> {
  if (!isPwaOfflinePath(pathname) || warmedPaths.has(pathname)) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || navigator.onLine === false) return;
  warmedPaths.add(pathname);
  try {
    await registerPwaServiceWorker();
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000);
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
    if (!navigator.serviceWorker.controller || typeof location === "undefined") return;
    await fetch(location.href, {
      headers: { Accept: "text/html" },
      credentials: "include",
      cache: "no-store",
    }).catch(() => undefined);
    const names = typeof performance !== "undefined"
      ? performance.getEntriesByType("resource").map((entry) => entry.name)
      : [];
    const assets = names.filter((name) => {
      try {
        const path = new URL(name).pathname;
        return path.startsWith("/_next/static/") && /\.(?:js|css|woff2?)$/.test(path);
      } catch {
        return false;
      }
    });
    await Promise.all(assets.slice(0, 80).map((name) => fetch(name, { cache: "no-store" }).catch(() => undefined)));
  } catch {
    warmedPaths.delete(pathname);
  }
}
