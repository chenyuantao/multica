// @vitest-environment node

import { ApiError } from "@multica/core/api";
import { createQueryClient } from "@multica/core/query-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachPwaReadCache,
  clearPwaCaches,
  flushPwaReadCache,
  raceCachedRead,
} from "./pwa-read-cache";

function installMemoryCache() {
  const store = new Map<string, string>();
  const cache = {
    async match(request: Request | string) {
      const url = typeof request === "string" ? request : request.url;
      const body = store.get(url);
      if (body === undefined) return undefined;
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    },
    async put(request: Request | string, response: Response) {
      const url = typeof request === "string" ? request : request.url;
      store.set(url, await response.text());
    },
  };
  globalThis.caches = {
    open: async () => cache,
    delete: async () => {
      store.clear();
      return true;
    },
  } as unknown as CacheStorage;
  return store;
}

afterEach(async () => {
  await clearPwaCaches();
});

describe("raceCachedRead", () => {
  it("returns the stored value first and then publishes the network value", async () => {
    const published: number[] = [];
    const result = await raceCachedRead({
      enabled: true,
      read: async () => 1,
      load: async () => 2,
      write: () => undefined,
      publish: (value) => published.push(value),
    });
    expect(result).toBe(1);
    await flushTicks();
    expect(published).toEqual([2]);
  });

  it("waits for the network when nothing is stored", async () => {
    let release: (value: number) => void = () => {};
    const pending = raceCachedRead({
      enabled: true,
      read: async () => undefined,
      load: () => new Promise<number>((resolve) => {
        release = resolve;
      }),
      write: () => undefined,
      publish: () => undefined,
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await flushTicks();
    expect(settled).toBe(false);
    release(5);
    await expect(pending).resolves.toBe(5);
  });
});

describe("query read cache", () => {
  it("shows the stored query first, then replaces it with the network result", async () => {
    installMemoryCache();
    const queryClient = createQueryClient();
    const key = ["group-chats", "ws-1", "list"] as const;
    const detach = attachPwaReadCache(queryClient, {
      patchGetMe: false,
      getPathname: () => "/acme/im",
      getUserId: () => "user-1",
    });

    await queryClient.prefetchQuery({
      queryKey: key,
      queryFn: async () => ({ chats: ["cached"] }),
      retry: 0,
    });
    await flushPwaReadCache();
    queryClient.removeQueries({ queryKey: key });

    let release: (value: { chats: string[] }) => void = () => {};
    const pending = queryClient.prefetchQuery({
      queryKey: key,
      queryFn: () => new Promise<{ chats: string[] }>((resolve) => {
        release = resolve;
      }),
      retry: 0,
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual({ chats: ["cached"] });
    });
    release({ chats: ["fresh"] });
    await pending;
    expect(queryClient.getQueryData(key)).toEqual({ chats: ["fresh"] });
    detach();
  });

  it("keeps the stored query when the network cannot be reached", async () => {
    installMemoryCache();
    const queryClient = createQueryClient();
    const key = ["docs", "file", "notes/a.md"] as const;
    const detach = attachPwaReadCache(queryClient, {
      patchGetMe: false,
      getPathname: () => "/acme/knowledge",
      getUserId: () => "user-1",
    });

    await queryClient.prefetchQuery({
      queryKey: key,
      queryFn: async () => ({ path: "notes/a.md", content: "hello" }),
      retry: 0,
    });
    await flushPwaReadCache();
    queryClient.removeQueries({ queryKey: key });

    await queryClient.prefetchQuery({
      queryKey: key,
      queryFn: async () => {
        throw new TypeError("Failed to fetch");
      },
      retry: 0,
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual({ path: "notes/a.md", content: "hello" });
      expect(queryClient.getQueryState(key)?.status).toBe("success");
    });
    detach();
  });

  it("does not hide a client error behind stored data", async () => {
    installMemoryCache();
    const queryClient = createQueryClient();
    const key = ["docs", "file", "notes/gone.md"] as const;
    const detach = attachPwaReadCache(queryClient, {
      patchGetMe: false,
      getPathname: () => "/acme/knowledge",
      getUserId: () => "user-1",
    });

    await queryClient.prefetchQuery({
      queryKey: key,
      queryFn: async () => ({ path: "notes/gone.md", content: "old" }),
      retry: 0,
    });
    await flushPwaReadCache();
    queryClient.removeQueries({ queryKey: key });

    await queryClient.prefetchQuery({
      queryKey: key,
      queryFn: async () => {
        throw new ApiError("missing", 404, "Not Found");
      },
      retry: 0,
    });
    await flushTicks();
    expect(queryClient.getQueryState(key)?.status).toBe("error");
    detach();
  });

  it("does not store queries from other pages", async () => {
    const store = installMemoryCache();
    const queryClient = createQueryClient();
    const detach = attachPwaReadCache(queryClient, {
      patchGetMe: false,
      getPathname: () => "/acme/issues",
      getUserId: () => "user-1",
    });
    await queryClient.prefetchQuery({
      queryKey: ["issues"],
      queryFn: async () => ({ rows: [1] }),
      retry: 0,
    });
    await flushPwaReadCache();
    expect(store.size).toBe(0);
    detach();
  });
});

async function flushTicks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(check: () => void): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      check();
      return;
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw last;
}
