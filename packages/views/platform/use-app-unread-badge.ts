import { useEffect } from "react";
import { useAppBadgeCount } from "@multica/core/inbox/queries";

type BadgeCapableAPI = {
  setUnreadBadge?: (count: number) => void;
};

type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function getDesktopAPI(): BadgeCapableAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { desktopAPI?: BadgeCapableAPI }).desktopAPI;
}

function setWebAppBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgingNavigator;
  // The Badging API rejects when the page may not badge (a plain browser tab,
  // or iOS before notification permission is granted); that is not an error.
  const pending = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
  pending?.catch(() => {});
}

/**
 * Mirror the unread count onto the app icon: the OS dock/taskbar badge on
 * desktop, and the installed web app's icon through the Badging API (iOS 16.4+
 * home screen apps, once notifications are allowed). The count only updates
 * while the app is running. With no workspace (login screen) the count is 0,
 * which clears a stale badge from a previous session.
 */
export function useAppUnreadBadge(wsId: string | null | undefined): void {
  const count = useAppBadgeCount(wsId);
  useEffect(() => {
    const desktopAPI = getDesktopAPI();
    if (desktopAPI) {
      desktopAPI.setUnreadBadge?.(count);
      return;
    }
    setWebAppBadge(count);
  }, [count]);
}
