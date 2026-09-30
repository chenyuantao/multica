import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

// The vault belongs to the deployment, not to a workspace, so keys carry no wsId.
export const docsKeys = {
  all: () => ["docs"] as const,
  tree: () => [...docsKeys.all(), "tree"] as const,
  search: (q: string) => [...docsKeys.all(), "search", q] as const,
  file: (path: string) => [...docsKeys.all(), "file", path] as const,
};

export function docsTreeOptions() {
  return queryOptions({
    queryKey: docsKeys.tree(),
    queryFn: () => api.getDocsTree(),
  });
}

export function docsSearchOptions(q: string) {
  return queryOptions({
    queryKey: docsKeys.search(q),
    queryFn: () => api.searchDocs(q),
    enabled: q.length > 0,
  });
}

export function docFileOptions(path: string) {
  return queryOptions({
    queryKey: docsKeys.file(path),
    queryFn: () => api.getDocFile(path),
    // The open editor owns the text; a background refetch must not reset it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
