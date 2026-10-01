/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { setApiInstance } from "../api";
import type { ApiClient } from "../api/client";
import { useDisableWebPush, useEnableWebPush, WebPushPermissionError } from "./mutations";

const platform = vi.hoisted(() => ({
  requestWebNotificationPermission: vi.fn(),
  subscribeWebPush: vi.fn(),
  getWebPushSubscription: vi.fn(),
}));

vi.mock("../platform/system-notification", () => ({
  requestWebNotificationPermission: platform.requestWebNotificationPermission,
}));
vi.mock("../platform/web-push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/web-push")>()),
  subscribeWebPush: platform.subscribeWebPush,
  getWebPushSubscription: platform.getWebPushSubscription,
}));

const ENDPOINT = "https://web.push.apple.com/device";

function fakeSubscription() {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let registerPushSubscription: ReturnType<typeof vi.fn>;
let deletePushSubscription: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  registerPushSubscription = vi.fn(async () => undefined);
  deletePushSubscription = vi.fn(async () => undefined);
  setApiInstance({ registerPushSubscription, deletePushSubscription } as unknown as ApiClient);
});

describe("useEnableWebPush", () => {
  it("registers the new subscription with its keys", async () => {
    platform.requestWebNotificationPermission.mockResolvedValue("granted");
    platform.subscribeWebPush.mockResolvedValue(fakeSubscription());
    const { result } = renderHook(() => useEnableWebPush(), { wrapper });

    await act(() => result.current.mutateAsync("vapid-key"));

    expect(platform.subscribeWebPush).toHaveBeenCalledWith("vapid-key");
    expect(registerPushSubscription).toHaveBeenCalledWith({
      platform: "webpush",
      token: ENDPOINT,
      keys: { p256dh: "p", auth: "a" },
    });
  });

  it("does not subscribe when permission is refused", async () => {
    platform.requestWebNotificationPermission.mockResolvedValue("denied");
    const { result } = renderHook(() => useEnableWebPush(), { wrapper });

    const error = await act(() => result.current.mutateAsync("vapid-key").catch((e: unknown) => e));

    expect(error).toBeInstanceOf(WebPushPermissionError);
    expect((error as WebPushPermissionError).permission).toBe("denied");
    expect(platform.subscribeWebPush).not.toHaveBeenCalled();
  });

  it("rolls back the device subscription when the server rejects it", async () => {
    const subscription = fakeSubscription();
    platform.requestWebNotificationPermission.mockResolvedValue("granted");
    platform.subscribeWebPush.mockResolvedValue(subscription);
    registerPushSubscription.mockRejectedValue(new Error("400"));
    const { result } = renderHook(() => useEnableWebPush(), { wrapper });

    await act(() => result.current.mutateAsync("vapid-key").catch(() => {}));

    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("useDisableWebPush", () => {
  it("keeps the device subscribed when the server delete fails", async () => {
    const subscription = fakeSubscription();
    platform.getWebPushSubscription.mockResolvedValue(subscription);
    deletePushSubscription.mockRejectedValue(new Error("500"));
    const { result } = renderHook(() => useDisableWebPush(), { wrapper });

    await act(() => result.current.mutateAsync().catch(() => {}));

    expect(deletePushSubscription).toHaveBeenCalledWith({ platform: "webpush", token: ENDPOINT });
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});
