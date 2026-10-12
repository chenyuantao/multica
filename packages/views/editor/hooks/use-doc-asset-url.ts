"use client";

import { useQuery } from "@tanstack/react-query";
import { docAssetOptions } from "@multica/core/docs";

const blobUrls = new Map<string, string>();

export function __resetDocAssetUrlCacheForTests(): void {
  for (const url of blobUrls.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // The test environment may not implement revoke.
    }
  }
  blobUrls.clear();
}

function isDirectAddress(value: string): boolean {
  return /^(https?:|blob:|data:)/i.test(value) || value.startsWith("/");
}

/** A loadable img address for one vault file. An http(s) or site path is used as-is. */
export function docAssetDisplayUrl(path: string, data: string, contentType: string): string {
  const cleaned = data.replace(/\s+/g, "");
  if (!cleaned) return "";
  if (isDirectAddress(cleaned)) return cleaned;
  const cached = blobUrls.get(path);
  if (cached) return cached;
  const type = contentType || "application/octet-stream";
  try {
    const padded = cleaned.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    blobUrls.set(path, url);
    return url;
  } catch {
    return `data:${type};base64,${cleaned}`;
  }
}

/**
 * Loads a vault image addressed by a `doc-asset:` path and exposes the
 * address the image node paints. A normal http(s) image passes null and
 * does no request. The address is ready in the same render as the asset
 * response, so the img is not left without a src after loading finishes.
 */
export function useDocAssetObjectUrl(path: string | null): { url: string; pending: boolean } {
  const query = useQuery({
    ...docAssetOptions(path ?? ""),
    enabled: Boolean(path),
  });
  if (!path) return { url: "", pending: false };
  const data = query.data?.data ?? "";
  const url = data ? docAssetDisplayUrl(path, data, query.data?.content_type ?? "") : "";
  return { url, pending: !url && query.isPending };
}
