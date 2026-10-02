"use client";

// Bridge between the OPPO Quick App shell (`apps/quickapp`) and the Multica
// web page loaded inside its `<web>` component. The shell owns
// service.push.subscribe; this module registers the resulting regId with the
// existing push_subscription API once the user is signed in.

import { api } from "../api";

const REG_ID_STORAGE_KEY = "multica.quickapp.oppo_reg_id";

export type QuickAppShellMessage =
  | { type: "oppo-push-regid"; regId: string }
  | { type: "navigate"; path: string }
  | { type: "ready" };

type SystemBridge = {
  postMessage?: (message: string) => void;
  onmessage?: ((data: string) => void) | null;
};

function systemBridge(): SystemBridge | null {
  if (typeof window === "undefined") return null;
  const system = (window as Window & { system?: SystemBridge }).system;
  return system ?? null;
}

/** True when this page is running inside a Quick App web component. */
export function isQuickAppShell(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/\bhap\//i.test(navigator.userAgent)) return true;
  return systemBridge() !== null;
}

export function readStoredOppoRegId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REG_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeOppoRegId(regId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REG_ID_STORAGE_KEY, regId);
  } catch {
    // Private mode / storage quota — registration can still proceed this session.
  }
}

export function postQuickAppMessage(message: QuickAppShellMessage): void {
  const system = systemBridge();
  if (!system?.postMessage) return;
  try {
    system.postMessage(JSON.stringify(message));
  } catch {
    // Shell may not be ready yet.
  }
}

function parseShellMessage(raw: string): QuickAppShellMessage | null {
  try {
    const parsed = JSON.parse(raw) as QuickAppShellMessage;
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Listen for shell messages. Returns an unsubscribe function. No-op outside
 * the Quick App web component.
 */
export function subscribeQuickAppShell(
  onMessage: (message: QuickAppShellMessage) => void,
): () => void {
  const system = systemBridge();
  if (!system) return () => {};

  const previous = system.onmessage;
  system.onmessage = (data: string) => {
    previous?.(data);
    const message = parseShellMessage(data);
    if (message) onMessage(message);
  };
  postQuickAppMessage({ type: "ready" });
  return () => {
    if (system.onmessage) {
      system.onmessage = previous ?? null;
    }
  };
}

/** Register this device's OPPO regId with the Multica API. */
export async function registerOppoPushSubscription(regId: string): Promise<void> {
  const trimmed = regId.trim();
  if (!trimmed) throw new Error("empty oppo regId");
  storeOppoRegId(trimmed);
  await api.registerPushSubscription({ platform: "oppo", token: trimmed });
}
