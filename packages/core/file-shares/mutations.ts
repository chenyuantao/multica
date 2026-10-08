import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { UpdateFileShareRequest } from "../types/file-share";
import { fileShareKeys } from "./queries";

export function useUpdateFileShare(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machine, patch }: { machine: string; patch: UpdateFileShareRequest }) =>
      api.updateFileShare(machine, patch),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: fileShareKeys.all(wsId) });
    },
  });
}
