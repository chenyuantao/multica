import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const messageCollectionKeys = {
  list: (wsId: string) => ["message-collections", wsId] as const,
};

export function messageCollectionListOptions(wsId: string) {
  return queryOptions({
    queryKey: messageCollectionKeys.list(wsId),
    queryFn: () => api.listMessageCollections(),
  });
}
