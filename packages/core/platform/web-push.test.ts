// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebPushSupport, subscribeWebPush, unsubscribeWebPush } from "./web-push";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

interface FakeEnv {
  userAgent: string;
  pushApi: boolean;
  standalone?: boolean;
  maxTouchPoints?: number;
  serviceWorker?: unknown;
}

function installEnv({ userAgent, pushApi, standalone = false, maxTouchPoints = 0, serviceWorker = {} }: FakeEnv) {
  const win: Record<string, unknown> = {
    matchMedia: (query: string) => ({ matches: standalone && query === "(display-mode: standalone)" }),
  };
  const nav: Record<string, unknown> = { userAgent, maxTouchPoints };
  if (pushApi) {
    win.PushManager = function PushManager() {};
    win.Notification = function Notification() {};
    nav.serviceWorker = serviceWorker;
  }
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getWebPushSupport", () => {
  it.each([
    { name: "no window (SSR)", env: null, want: "unsupported" },
    { name: "Android Chrome with Push API", env: { userAgent: ANDROID_UA, pushApi: true }, want: "supported" },
    { name: "iPhone Home Screen app", env: { userAgent: IPHONE_UA, pushApi: true, standalone: true }, want: "supported" },
    { name: "iPhone Safari tab", env: { userAgent: IPHONE_UA, pushApi: false }, want: "requires-install" },
    { name: "iPad Safari tab with desktop UA", env: { userAgent: IPAD_DESKTOP_UA, pushApi: false, maxTouchPoints: 5 }, want: "requires-install" },
    { name: "Mac Safari without Push API", env: { userAgent: IPAD_DESKTOP_UA, pushApi: false }, want: "unsupported" },
    { name: "Android in-app browser without Push API", env: { userAgent: ANDROID_UA, pushApi: false }, want: "unsupported" },
  ] as const)("$name → $want", ({ env, want }) => {
    if (env) installEnv(env);
    expect(getWebPushSupport()).toBe(want);
  });
});

describe("subscribeWebPush", () => {
  it("registers the root-scoped worker and decodes the VAPID key", async () => {
    const subscribe = vi.fn(async (_options: PushSubscriptionOptionsInit) => ({ endpoint: "https://web.push.apple.com/x" }));
    const registration = { pushManager: { getSubscription: vi.fn(async () => null), subscribe } };
    const register = vi.fn(async () => registration);
    installEnv({ userAgent: ANDROID_UA, pushApi: true, serviceWorker: { register, ready: Promise.resolve(registration) } });

    await subscribeWebPush("AQID-_8");

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    const options = subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect(Array.from(options?.applicationServerKey as Uint8Array)).toEqual([1, 2, 3, 251, 255]);
  });
});

describe("unsubscribeWebPush", () => {
  it("is a no-op without a Push API", async () => {
    await expect(unsubscribeWebPush()).resolves.toBeNull();
  });

  it("unsubscribes the device's current subscription", async () => {
    const subscription = { unsubscribe: vi.fn(async () => true) };
    const registration = { pushManager: { getSubscription: vi.fn(async () => subscription) } };
    installEnv({ userAgent: ANDROID_UA, pushApi: true, serviceWorker: { getRegistration: vi.fn(async () => registration) } });

    await expect(unsubscribeWebPush()).resolves.toBe(subscription);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});
