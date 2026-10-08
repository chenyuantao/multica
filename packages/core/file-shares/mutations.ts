import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { UpdateFileShareRequest } from "../types/file-share";
import { fileShareKeys } from "./queries";

export function useUpdateFileShare(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ daemonId, patch }: { daemonId: string; patch: UpdateFileShareRequest }) =>
      api.updateFileShare(daemonId, patch),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: fileShareKeys.all(wsId) });
    },
  });
}
