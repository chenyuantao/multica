"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { docAssetOptions } from "@multica/core/docs";

/**
 * Loads a vault image addressed by a `doc-asset:` path and exposes a blob URL
 * the image node can paint. A normal http(s) image passes null and does no
 * request.
 */
export function useDocAssetObjectUrl(path: string | null): { url: string; pending: boolean } {
  const query = useQuery({
    ...docAssetOptions(path ?? ""),
    enabled: Boolean(path),
  });
  const [url, setUrl] = useState("");

  useEffect(() => {
    const data = query.data?.data;
    if (!path || !data) {
      setUrl("");
      return;
    }
    let binary: string;
    try {
      binary = atob(data);
    } catch {
      setUrl("");
      return;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: query.data?.content_type || "application/octet-stream" });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [path, query.data]);

  if (!path) return { url: "", pending: false };
  return { url, pending: query.isPending };
}
