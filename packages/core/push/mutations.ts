import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  getWebPushSubscription,
  subscribeWebPush,
  toPushSubscriptionInput,
} from "../platform/web-push";
import {
  requestWebNotificationPermission,
  type WebNotificationPermission,
} from "../platform/system-notification";
import { pushKeys } from "./queries";

export class WebPushPermissionError extends Error {
  constructor(readonly permission: WebNotificationPermission) {
    super(`notification permission ${permission}`);
    this.name = "WebPushPermissionError";
  }
}

/**
 * Prompt, subscribe this device, and register it. Call `mutate` straight from
 * the click handler: Safari only shows the permission prompt inside a user
 * gesture.
 */
export function useEnableWebPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (publicKey: string) => {
      const permission = await requestWebNotificationPermission();
      if (permission !== "granted") throw new WebPushPermissionError(permission);
      const subscription = await subscribeWebPush(publicKey);
      try {
        await api.registerPushSubscription(toPushSubscriptionInput(subscription));
      } catch (err) {
        // A device the server does not know about must not look enabled.
        await subscription.unsubscribe().catch(() => {});
        throw err;
      }
      return subscription;
    },
    onSuccess: () => {
      qc.setQueryData(pushKeys.webSubscription(), true);
    },
  });
}

/** Unregister first so a failed request leaves the device consistently enabled. */
export function useDisableWebPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const subscription = await getWebPushSubscription();
      if (!subscription) return;
      await api.deletePushSubscription({ platform: "webpush", token: subscription.endpoint });
      await subscription.unsubscribe();
    },
    onSuccess: () => {
      qc.setQueryData(pushKeys.webSubscription(), false);
    },
  });
}
