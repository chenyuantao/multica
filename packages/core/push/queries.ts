import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

// Account-level: the push config and devices are not workspace-scoped.
export const pushKeys = {
  config: () => ["push", "config"] as const,
};

export function pushConfigOptions() {
  return queryOptions({
    queryKey: pushKeys.config(),
    queryFn: () => api.getPushConfig(),
    staleTime: Infinity,
  });
}
