"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../auth";
import { pushConfigOptions } from "../push";
import {
  isQuickAppShell,
  readStoredOppoRegId,
  registerOppoPushSubscription,
  subscribeQuickAppShell,
} from "../platform/quickapp-bridge";

/**
 * While Multica runs inside the OPPO Quick App shell, keep the device's
 * service.push regId registered for the signed-in account. Renders nothing.
 */
export function useQuickAppOppoPushRegistration(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: config } = useQuery({
    ...pushConfigOptions(),
    enabled: Boolean(userId) && isQuickAppShell(),
  });
  const lastRegistered = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !config?.oppo_push_enabled || !isQuickAppShell()) return;

    const register = (regId: string) => {
      const key = `${userId}:${regId}`;
      if (lastRegistered.current === key) return;
      void registerOppoPushSubscription(regId)
        .then(() => {
          lastRegistered.current = key;
        })
        .catch(() => {
          // Leave lastRegistered unset so the next shell message retries.
        });
    };

    const stored = readStoredOppoRegId();
    if (stored) register(stored);

    return subscribeQuickAppShell((message) => {
      if (message.type === "oppo-push-regid" && message.regId) {
        register(message.regId);
      }
      if (message.type === "navigate" && message.path.startsWith("/")) {
        window.location.assign(message.path);
      }
    });
  }, [userId, config?.oppo_push_enabled]);
}
