import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CreateDocFileRequest, DocFile, DocMoveResult, MoveDocRequest, SaveDocFileRequest } from "../types";
import { relocatedDocPath } from "./move-path";
import { docsKeys } from "./queries";

function relocateCachedDocs(qc: QueryClient, from: string, to: string) {
  const entries = qc.getQueriesData<DocFile>({ queryKey: [...docsKeys.all(), "file"] });
  for (const [key, file] of entries) {
    const path = key[2];
    if (typeof path !== "string" || !file) continue;
    const next = relocatedDocPath(path, from, to);
    if (!next) continue;
    qc.setQueryData<DocFile>(docsKeys.file(next), {
      ...file,
      path: next,
      name: next.split("/").pop() ?? file.name,
    });
    qc.removeQueries({ queryKey: docsKeys.file(path), exact: true });
  }
}

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

export function useMoveDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MoveDocRequest) => api.moveDoc(data),
    onSuccess: (result: DocMoveResult) => {
      relocateCachedDocs(qc, result.from, result.path);
      void qc.invalidateQueries({ queryKey: docsKeys.tree() });
      void qc.invalidateQueries({ queryKey: [...docsKeys.all(), "search"] });
    },
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
