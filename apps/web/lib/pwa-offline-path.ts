/**
 * Routes that can be opened with no network after one successful visit:
 * group chats, contacts, and the knowledge vault. Mirrors
 * `public/pwa-offline-path.js` (the service worker cannot import TypeScript).
 */
export function isPwaOfflinePath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "im") return true;
  return parts.length >= 2 && (parts[1] === "im" || parts[1] === "member" || parts[1] === "knowledge");
}

export const PWA_SHELL_CACHE = "multica-pwa-shell-v1";
export const PWA_READ_CACHE = "multica-pwa-reads-v1";
