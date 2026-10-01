// Service worker for Web Push. Deliberately has no fetch handler: it must not
// change how the app loads, only receive inbox pushes and route their clicks.
// The payload shape is server/internal/push.Message.

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
