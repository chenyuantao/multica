// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPwaOfflinePath, PWA_READ_CACHE, PWA_SHELL_CACHE } from "./pwa-offline-path";

const here = dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(join(here, "../public/pwa-offline-path.js"), "utf8");
const worker = readFileSync(join(here, "../public/sw.js"), "utf8");

interface HeaderBag {
  get(name: string): string;
}

interface PwaRequest {
  method: string;
  url: string;
  mode: string;
  destination: string;
  headers: HeaderBag;
}

const sandbox = {
  self: { location: { origin: "https://app.test" } },
  URL,
} as {
  self: { location: { origin: string } };
  URL: typeof URL;
  isPwaOfflinePath: (pathname: string) => boolean;
  shouldHandlePwaRequest: (request: PwaRequest) => boolean;
  pwaShellCacheKey: (request: PwaRequest) => string;
};

runInNewContext(shared, sandbox);

function req(
  url: string,
  init?: { method?: string; mode?: string; destination?: string; headers?: Record<string, string> },
): PwaRequest {
  const headers = new Map(
    Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    method: init?.method ?? "GET",
    url,
    mode: init?.mode ?? "",
    destination: init?.destination ?? "",
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? "" },
  };
}

describe("offline page paths", () => {
  const paths = [
    "/im",
    "/im/extra",
    "/acme/im",
    "/acme/im/thread",
    "/acme/member",
    "/acme/knowledge",
    "/acme/knowledge/note",
    "/acme/reminder",
    "/acme/collect",
    "/member",
    "/knowledge",
    "/acme/issues",
    "/acme",
    "/",
  ];

  it("agrees with the service worker copy", () => {
    for (const path of paths) {
      expect(sandbox.isPwaOfflinePath(path)).toBe(isPwaOfflinePath(path));
    }
  });

  it("includes the three pages and the legacy launcher", () => {
    expect(isPwaOfflinePath("/im")).toBe(true);
    expect(isPwaOfflinePath("/acme/im")).toBe(true);
    expect(isPwaOfflinePath("/acme/member")).toBe(true);
    expect(isPwaOfflinePath("/acme/knowledge")).toBe(true);
    expect(isPwaOfflinePath("/acme/reminder")).toBe(true);
    expect(isPwaOfflinePath("/acme/collect")).toBe(true);
    expect(isPwaOfflinePath("/acme/issues")).toBe(false);
    expect(isPwaOfflinePath("/member")).toBe(false);
  });
});

describe("service worker request selection", () => {
  it("caches documents and static assets for the three pages only", () => {
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/acme/im", { mode: "navigate", destination: "document", headers: { accept: "text/html" } }))).toBe(true);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/acme/member", { headers: { accept: "text/html" } }))).toBe(true);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/acme/knowledge", { headers: { RSC: "1" } }))).toBe(true);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/_next/static/chunks/app.js"))).toBe(true);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/_next/static/chunks/app.css"))).toBe(true);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/acme/issues", { mode: "navigate", destination: "document", headers: { accept: "text/html" } }))).toBe(false);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/api/group-chats"))).toBe(false);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/api/docs/tree", { method: "POST" }))).toBe(false);
    expect(sandbox.shouldHandlePwaRequest(req("https://other.test/acme/im", { mode: "navigate" }))).toBe(false);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/acme/im", { headers: { "Next-Router-Prefetch": "1", RSC: "1" } }))).toBe(false);
    expect(sandbox.shouldHandlePwaRequest(req("https://app.test/_next/static/webpack/app.hot-update.js"))).toBe(false);
  });

  it("stores the document and its RSC payload under different keys", () => {
    const documentKey = sandbox.pwaShellCacheKey(req("https://app.test/acme/im", { mode: "navigate", headers: { accept: "text/html" } }));
    const rscKey = sandbox.pwaShellCacheKey(req("https://app.test/acme/im", { headers: { RSC: "1" } }));
    expect(documentKey).not.toBe(rscKey);
    expect(documentKey).toContain("__pwa=doc");
    expect(rscKey).toContain("__pwa=rsc");
  });

  it("keeps the worker on the push script and the shared cache names", () => {
    expect(worker).toContain('importScripts("/pwa-offline-path.js")');
    expect(worker).toContain('addEventListener("fetch"');
    expect(worker).toContain('addEventListener("push"');
    expect(shared).toContain(PWA_SHELL_CACHE);
    expect(shared).toContain(PWA_READ_CACHE);
  });
});
