import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import { getWebPushSubscription } from "../platform/web-push";

// Account-level: the push config and devices are not workspace-scoped.
export const pushKeys = {
  config: () => ["push", "config"] as const,
  webSubscription: () => ["push", "web-subscription"] as const,
};

/** Whether this browser currently holds a Web Push subscription. */
export function webPushSubscriptionOptions() {
  return queryOptions({
    queryKey: pushKeys.webSubscription(),
    queryFn: async () => (await getWebPushSubscription()) !== null,
    staleTime: Infinity,
  });
}

export function pushConfigOptions() {
  return queryOptions({
    queryKey: pushKeys.config(),
    queryFn: () => api.getPushConfig(),
    staleTime: Infinity,
  });
}
