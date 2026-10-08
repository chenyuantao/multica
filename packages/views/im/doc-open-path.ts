"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { docsKeys, docsTreeOptions } from "@multica/core/docs";
import type { DocNode } from "@multica/core/types";
import { resolveDocPath } from "./knowledge-utils";

/** Card path mapped onto the current docs tree, ignoring the knowledge root. */
export function useDocOpenPath(cardPath: string): string {
  const { data: tree = [] } = useQuery(docsTreeOptions());
  return resolveDocPath(cardPath, tree) ?? cardPath;
}

/** Resolves a card path at the moment it is opened, loading the tree if needed. */
export async function docPathToOpen(qc: QueryClient, cardPath: string): Promise<string> {
  let nodes = qc.getQueryData<DocNode[]>(docsKeys.tree());
  if (!nodes) {
    try {
      nodes = await qc.fetchQuery(docsTreeOptions());
    } catch {
      nodes = [];
    }
  }
  return resolveDocPath(cardPath, nodes) ?? cardPath;
}
