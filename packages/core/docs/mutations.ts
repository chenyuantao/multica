import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, errorCode } from "../api";
import type {
  CreateDocFileRequest,
  CreateDocFolderRequest,
  DeleteDocRequest,
  DocFile,
  DocMoveResult,
  MoveDocRequest,
  RenameDocRequest,
  SaveDocFileRequest,
} from "../types";
import { relocatedDocPath } from "./move-path";
import { docsKeys } from "./queries";

function dropCachedDocs(qc: QueryClient, path: string) {
  const entries = qc.getQueriesData<DocFile>({ queryKey: [...docsKeys.all(), "file"] });
  for (const [key] of entries) {
    const cached = key[2];
    if (typeof cached !== "string" || !cached) continue;
    if (cached === path || cached.startsWith(`${path}/`)) {
      qc.removeQueries({ queryKey: docsKeys.file(cached), exact: true });
    }
  }
}

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

export function useCreateDocFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDocFolderRequest) => api.createDocFolder(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: docsKeys.tree() });
    },
  });
}

export function useRenameDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RenameDocRequest) => api.renameDoc(data),
    onSuccess: (result: DocMoveResult) => {
      relocateCachedDocs(qc, result.from, result.path);
      void qc.invalidateQueries({ queryKey: docsKeys.tree() });
      void qc.invalidateQueries({ queryKey: [...docsKeys.all(), "search"] });
    },
  });
}

export function useDeleteDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteDocRequest) => api.deleteDoc(data),
    onSuccess: (result) => {
      dropCachedDocs(qc, result.path);
      void qc.invalidateQueries({ queryKey: docsKeys.tree() });
      void qc.invalidateQueries({ queryKey: [...docsKeys.all(), "search"] });
    },
    onError: (err, variables) => {
      if (errorCode(err) !== "docs_not_found") return;
      dropCachedDocs(qc, variables.path);
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
