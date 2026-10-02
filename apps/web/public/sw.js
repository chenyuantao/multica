// Service worker for Web Push, plus an offline shell for /im, /member and
// /knowledge. Push payload shape: server/internal/push.Message.
//
// The fetch handler is network-first and only answers those three pages
// (documents and their RSC requests) and the static JS/CSS/fonts they load.
// /api is never intercepted — read responses live in Cache Storage on the
// page side, so a cached payload can be shown and then replaced by the
// network. A failed network falls back to the last cached shell.

importScripts("/pwa-offline-path.js");

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Multica";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/inbox";
  const badge = typeof data.badge === "number" ? data.badge : 0;

  const tasks = [
    // Every push must show a notification: browsers revoke subscriptions
    // that receive silent pushes.
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      data: { url },
    }),
  ];
  if (badge > 0 && "setAppBadge" in self.navigator) {
    tasks.push(self.navigator.setAppBadge(badge).catch(() => {}));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && event.notification.data.url;
  const target = new URL(typeof path === "string" ? path : "/inbox", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        // navigate() rejects for a window this worker does not control yet.
        const navigated = await client.navigate(target).then(
          () => true,
          () => false,
        );
        if (navigated) return;
        break;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (!shouldHandlePwaRequest(event.request)) return;
  event.respondWith(handlePwaFetch(event));
});

function pwaImEntryRequest() {
  return new Request(new URL("/__pwa_im_entry__", self.location.origin).href, { method: "GET" });
}

async function storePwaResponse(cache, key, response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  const body = await response.blob();
  await cache.put(new Request(key, { method: "GET" }), new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

async function rememberImEntry(cache, pathname) {
  const path = pwaImSectionPath(pathname);
  if (!path) return;
  await cache.put(pwaImEntryRequest(), new Response(JSON.stringify({ path }), {
    headers: { "Content-Type": "application/json" },
  }));
}

async function handleLegacyIm(request) {
  try {
    const response = await fetch(request);
    // A redirected navigation response cannot be returned as-is. Send the
    // browser to the workspace page the proxy already chose.
    if (response.redirected) return Response.redirect(response.url, 302);
    return response;
  } catch (err) {
    const cache = await caches.open(PWA_SHELL_CACHE);
    const entry = await cache.match(pwaImEntryRequest());
    if (!entry) throw err;
    try {
      const body = await entry.json();
      if (body && typeof body.path === "string" && body.path.indexOf("/") === 0) {
        return Response.redirect(new URL(body.path, self.location.origin).href, 302);
      }
    } catch (parseErr) {
      // Fall through to the original network error.
    }
    throw err;
  }
}

async function pageOwnsRequest(event) {
  try {
    const client = event.clientId ? await self.clients.get(event.clientId) : null;
    if (client && isPwaOfflinePath(new URL(client.url).pathname)) return true;
  } catch (e) {
    // A missing client just means we will not write a new asset.
  }
  if (!event.request.referrer) return false;
  try {
    return isPwaOfflinePath(new URL(event.request.referrer).pathname);
  } catch (e) {
    return false;
  }
}

async function handlePwaFetch(event) {
  try {
    return await handlePwaFetchInner(event);
  } catch (err) {
    // A bug in the cache path must not take the page down while the network
    // is up. Offline, this second fetch fails too and the caller sees that.
    try {
      return await fetch(event.request);
    } catch (networkErr) {
      const cache = await caches.open(PWA_SHELL_CACHE);
      const cached = await cache.match(pwaShellCacheKey(event.request));
      if (cached) return cached;
      throw networkErr;
    }
  }
}

async function handlePwaFetchInner(event) {
  const request = event.request;
  const url = new URL(request.url);
  if (url.pathname === "/im") return handleLegacyIm(request);

  const cache = await caches.open(PWA_SHELL_CACHE);
  const key = pwaShellCacheKey(request);
  const asset = pwaIsStaticAsset(url.pathname);
  try {
    const response = await fetch(request);
    if (request.mode === "navigate" && response.redirected) {
      return Response.redirect(response.url, 302);
    }
    const onPage = asset ? await pageOwnsRequest(event) : true;
    if (response.status === 200 && onPage) {
      const finalPath = new URL(response.url).pathname;
      if (!response.redirected && (asset || isPwaOfflinePath(finalPath))) {
        // Caching is an extra. A quota or body error must not fail the page.
        try {
          await storePwaResponse(cache, key, response.clone());
          if (!asset) await rememberImEntry(cache, finalPath);
        } catch (storeErr) {
          // Ignore. The network response is still returned below.
        }
      }
    }
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw err;
  }
}
