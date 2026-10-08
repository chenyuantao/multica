// Shared by apps/web/public/sw.js (importScripts) and the web app.
// Keep the path rules in sync with isPwaOfflinePath in
// apps/web/lib/pwa-offline-path.ts — pwa-offline-path.test.ts checks both.

var PWA_SHELL_CACHE = "multica-pwa-shell-v1";
var PWA_READ_CACHE = "multica-pwa-reads-v1";

function isPwaOfflinePath(pathname) {
  var parts = String(pathname || "").split("/").filter(Boolean);
  // Legacy launcher entry. The proxy sends a signed-in session on to
  // /{slug}/im; the worker only special-cases this path when the network
  // cannot do that redirect.
  if (parts[0] === "im") return true;
  return parts.length >= 2 && (parts[1] === "im" || parts[1] === "member" || parts[1] === "knowledge" || parts[1] === "reminder" || parts[1] === "collect");
}

function pwaHeader(request, name) {
  var headers = request && request.headers;
  if (!headers || typeof headers.get !== "function") return "";
  return headers.get(name) || "";
}

function pwaIsPrefetch(request) {
  return pwaHeader(request, "Next-Router-Prefetch") === "1" ||
    pwaHeader(request, "Purpose") === "prefetch" ||
    pwaHeader(request, "Sec-Purpose") === "prefetch";
}

function pwaIsStaticAsset(pathname) {
  if (pathname.indexOf("/_next/static/") !== 0) return false;
  if (pathname.indexOf(".hot-update.") !== -1) return false;
  return /\.(?:js|css|woff2?)$/.test(pathname);
}

// True when this worker should answer the request. Everything else,
// including /api, falls through to the network untouched.
function shouldHandlePwaRequest(request) {
  if (!request || request.method !== "GET") return false;
  if (pwaHeader(request, "range")) return false;
  if (pwaIsPrefetch(request)) return false;
  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return false;
  }
  if (typeof self !== "undefined" && self.location && url.origin !== self.location.origin) return false;
  var path = url.pathname;
  if (path === "/sw.js" || path === "/pwa-offline-path.js") return false;
  if (path.indexOf("/api/") === 0 || path.indexOf("/uploads/") === 0 || path.indexOf("/auth/") === 0 || path === "/ws") {
    return false;
  }
  if (pwaIsStaticAsset(path)) return true;
  if (!isPwaOfflinePath(path)) return false;
  if (request.mode === "navigate" || request.destination === "document") return true;
  if (pwaHeader(request, "RSC") === "1") return true;
  if (pwaHeader(request, "accept").indexOf("text/html") !== -1) return true;
  return false;
}

function pwaShellCacheKey(request) {
  var url = new URL(request.url);
  var kind = "asset";
  if (pwaHeader(request, "RSC") === "1") kind = "rsc";
  else if (
    request.mode === "navigate" ||
    request.destination === "document" ||
    pwaHeader(request, "accept").indexOf("text/html") !== -1
  ) {
    kind = "doc";
  }
  url.searchParams.set("__pwa", kind);
  return url.toString();
}

// /{slug}/im exactly — the page the legacy /im entry should open offline.
function pwaImSectionPath(pathname) {
  var parts = String(pathname || "").split("/").filter(Boolean);
  if (parts.length === 2 && parts[1] === "im") return "/" + parts[0] + "/im";
  return "";
}
