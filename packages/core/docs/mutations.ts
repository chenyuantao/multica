import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CreateDocFileRequest, DocFile, SaveDocFileRequest } from "../types";
import { docsKeys } from "./queries";

export function useCreateDocFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDocFileRequest) => api.createDocFile(data),
    onSuccess: (file) => {
      qc.setQueryData<DocFile>(docsKeys.file(file.path), file);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: docsKeys.tree() }),
  });
}

export function useSaveDocFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveDocFileRequest) => api.saveDocFile(data),
    onSuccess: (file) => {
      qc.setQueryData<DocFile>(docsKeys.file(file.path), file);
      // Modified times in the tree and search hits are now stale.
      void qc.invalidateQueries({ queryKey: docsKeys.tree() });
    },
  });
}
