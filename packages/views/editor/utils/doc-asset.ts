/**
 * Address of a vault image the knowledge editor displays.
 *
 * The note on disk keeps its original embed. The editor swaps that embed for
 * an image whose src is this token, then asks POST /api/docs/files/asset for
 * the bytes. `path` is the machine-prefixed vault path. `raw` is the original
 * destination, so a save can write the embed back unchanged.
 */
export interface DocAssetRef {
  path: string;
  raw: string;
  kind: "wiki" | "md";
}

export const DOC_ASSET_PREFIX = "doc-asset:";

export function docAssetSrc(ref: DocAssetRef): string {
  const bytes = new TextEncoder().encode(JSON.stringify(ref));
  return DOC_ASSET_PREFIX + base64Url(bytes);
}

export function parseDocAssetSrc(src: string): DocAssetRef | null {
  if (!src.startsWith(DOC_ASSET_PREFIX)) return null;
  const payload = src.slice(DOC_ASSET_PREFIX.length);
  const candidates = [payload];
  try {
    const decoded = decodeURIComponent(payload);
    if (decoded !== payload) candidates.push(decoded);
  } catch {
    // The editor sometimes stores the token as it was written.
  }
  for (const candidate of candidates) {
    const ref = decodeRef(candidate);
    if (ref) return ref;
  }
  return null;
}

function decodeRef(payload: string): DocAssetRef | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Partial<DocAssetRef>;
    if (parsed.kind !== "wiki" && parsed.kind !== "md") return null;
    if (typeof parsed.path !== "string" || parsed.path === "" || typeof parsed.raw !== "string" || parsed.raw === "") {
      return null;
    }
    return { path: parsed.path, raw: parsed.raw, kind: parsed.kind };
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(payload: string): Uint8Array {
  const padded = payload.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (payload.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
