"use client";

// Browser side of Web Push: the service worker registration and the
// PushManager subscription for this device. Pairs with apps/web/public/sw.js,
// which renders the pushes; the server only delivers while no Multica client
// is connected, so these never duplicate the in-page banners.

import type { PushSubscriptionInput } from "../types/push";

export const WEB_PUSH_SERVICE_WORKER_URL = "/sw.js";

/**
 * - "supported": this context can subscribe.
 * - "requires-install": iOS/iPadOS Safari, where Web Push exists only for a web
 *   app opened from the Home Screen.
 * - "unsupported": no Push API (SSR, older engines, in-app browsers).
 */
export type WebPushSupport = "supported" | "requires-install" | "unsupported";

function env(): { window: Window & typeof globalThis; navigator: Navigator } | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return { window, navigator };
}

function isAppleMobile(nav: Navigator): boolean {
  // iPadOS reports a desktop Mac user agent; touch support tells them apart.
  return /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

function isStandalone(win: Window, nav: Navigator): boolean {
  return win.matchMedia?.("(display-mode: standalone)").matches === true ||
    (nav as Navigator & { standalone?: boolean }).standalone === true;
}

export function getWebPushSupport(): WebPushSupport {
  const e = env();
  if (!e) return "unsupported";
  const hasApi = "serviceWorker" in e.navigator && "PushManager" in e.window && "Notification" in e.window;
  if (hasApi) return "supported";
  if (isAppleMobile(e.navigator) && !isStandalone(e.window, e.navigator)) return "requires-install";
  return "unsupported";
}

/** The subscription this device currently holds, without registering a worker. */
export async function getWebPushSubscription(): Promise<PushSubscription | null> {
  if (getWebPushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function applicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function toPushSubscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  const json = subscription.toJSON();
  return {
    platform: "webpush",
    token: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}

/**
 * Register the service worker and subscribe this device. Must run inside a
 * user gesture on Safari, which also owns the permission prompt.
 */
export async function subscribeWebPush(publicKey: string): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.register(WEB_PUSH_SERVICE_WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
}

/**
 * Drop this device's subscription at the push service. The server learns it
 * is gone on its next delivery attempt and deletes its record, so this needs
 * no session.
 */
export async function unsubscribeWebPush(): Promise<PushSubscription | null> {
  try {
    const subscription = await getWebPushSubscription();
    if (!subscription) return null;
    await subscription.unsubscribe();
    return subscription;
  } catch {
    return null;
  }
}
