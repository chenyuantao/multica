import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const fileShareKeys = {
  all: (wsId: string) => ["file-shares", wsId] as const,
  list: (wsId: string) => [...fileShareKeys.all(wsId), "list"] as const,
};

export function fileShareListOptions(wsId: string) {
  return queryOptions({
    queryKey: fileShareKeys.list(wsId),
    queryFn: () => api.listFileShares(),
    enabled: !!wsId,
    refetchInterval: 10_000,
  });
}
