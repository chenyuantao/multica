import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CreateMessageCollectionRequest, MessageCollection } from "../types";
import { messageCollectionKeys } from "./queries";

export function useCreateMessageCollection(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMessageCollectionRequest) => api.createMessageCollection(data),
    onSuccess: (item) => {
      qc.setQueryData<MessageCollection[]>(messageCollectionKeys.list(wsId), (old) => [
        item,
        ...(old ?? []).filter((saved) => saved.id !== item.id),
      ]);
    },
  });
}

export function useDeleteMessageCollection(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMessageCollection(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<MessageCollection[]>(messageCollectionKeys.list(wsId), (old) =>
        old?.filter((saved) => saved.id !== id),
      );
    },
  });
}
