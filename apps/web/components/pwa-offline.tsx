"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@multica/core/auth";
import { isPwaOfflinePath } from "@/lib/pwa-offline-path";
import { attachPwaReadCache, clearPwaCaches, registerPwaServiceWorker, warmPwaShell } from "@/lib/pwa-read-cache";

/**
 * Registers the service worker and the read-through cache for /im, /member
 * and /knowledge. Mounted once under the query client.
 */
export function PwaOffline() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const status = useAuthStore((s) => s.status);

  useEffect(() => attachPwaReadCache(queryClient), [queryClient]);

  useEffect(() => {
    // Register only after a visit to one of the three pages, so the public
    // site does not gain a controlling worker just by being opened.
    if (!isPwaOfflinePath(pathname)) return;
    void registerPwaServiceWorker();
    void warmPwaShell(pathname);
  }, [pathname]);

  useEffect(() => {
    // The next person on this browser must not open the previous session's
    // chats or notes. Unauthenticated is logout and a rejected credential.
    if (status !== "unauthenticated") return;
    void clearPwaCaches();
  }, [status]);

  return null;
}
