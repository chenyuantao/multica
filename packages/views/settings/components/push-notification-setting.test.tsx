import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const api = vi.hoisted(() => ({
  getPushConfig: vi.fn(),
  registerPushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
}));
vi.mock("@multica/core/api", () => ({ api }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { BrowserNotificationSetting } from "./browser-notification-setting";
import { PushNotificationSetting } from "./push-notification-setting";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en" resources={{ en: { common: enCommon, settings: enSettings } }}>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
}

const restore: Array<() => void> = [];

function define(target: object, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  restore.push(() => {
    if (previous) Object.defineProperty(target, key, previous);
    else delete (target as Record<string, unknown>)[key];
  });
}

function installBrowser(userAgent: string, { pushApi }: { pushApi: boolean }) {
  define(navigator, "userAgent", userAgent);
  define(window, "matchMedia", () => ({ matches: false }));
  // jsdom has no Push API of its own.
  if (!pushApi) return null;
  let current: unknown = null;
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async () => {
        current = subscription;
        return subscription;
      }),
    },
  };
  define(window, "PushManager", function PushManager() {});
  define(window, "Notification", Object.assign(function Notification() {}, {
    permission: "default",
    requestPermission: vi.fn(async () => "granted"),
  }));
  define(navigator, "serviceWorker", {
    register: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  });
  return registration;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getPushConfig.mockResolvedValue({ web_push_public_key: "AQID" });
  api.registerPushSubscription.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  while (restore.length) restore.pop()?.();
});

describe("PushNotificationSetting", () => {
  it("renders nothing when the server has no Web Push key", async () => {
    api.getPushConfig.mockResolvedValue({ web_push_public_key: "" });
    installBrowser(ANDROID_UA, { pushApi: true });
    const { container } = render(<PushNotificationSetting />, { wrapper });

    await waitFor(() => expect(api.getPushConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("asks iPhone Safari users to install to the Home Screen first", async () => {
    installBrowser(IPHONE_UA, { pushApi: false });
    render(<PushNotificationSetting />, { wrapper });

    expect(await screen.findByText(/add Multica to your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("subscribes and registers this device when turned on", async () => {
    installBrowser(ANDROID_UA, { pushApi: true });
    render(<PushNotificationSetting />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));

    expect(await screen.findByRole("button", { name: "Turn off" })).toBeInTheDocument();
    expect(api.registerPushSubscription).toHaveBeenCalledWith({
      platform: "webpush",
      token: ENDPOINT,
      keys: { p256dh: "p", auth: "a" },
    });
  });
});

describe("BrowserNotificationSetting", () => {
  it("subscribes this device to push when browser notifications are enabled", async () => {
    installBrowser(ANDROID_UA, { pushApi: true });
    render(<BrowserNotificationSetting />, { wrapper });

    const enable = await screen.findByRole("button", { name: "Enable" });
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(enable);

    await waitFor(() => expect(api.registerPushSubscription).toHaveBeenCalledWith({
      platform: "webpush",
      token: ENDPOINT,
      keys: { p256dh: "p", auth: "a" },
    }));
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });
});
