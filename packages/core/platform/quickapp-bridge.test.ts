// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isQuickAppShell,
  postQuickAppMessage,
  readStoredOppoRegId,
  storeOppoRegId,
  subscribeQuickAppShell,
} from "./quickapp-bridge";

vi.mock("../api", () => ({
  api: {
    registerPushSubscription: vi.fn(async () => undefined),
  },
}));

describe("quickapp-bridge", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "system");
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects the hap user agent", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 hap/1113/oppo com.multica.shell/1.0.0 Multica/1.0.0",
    });
    expect(isQuickAppShell()).toBe(true);
  });

  it("detects window.system from the web component", () => {
    (window as Window & { system: { postMessage: () => void } }).system = {
      postMessage: () => {},
    };
    expect(isQuickAppShell()).toBe(true);
  });

  it("stores and reads the OPPO regId", () => {
    storeOppoRegId("CN_abc");
    expect(readStoredOppoRegId()).toBe("CN_abc");
  });

  it("posts JSON messages to the shell", () => {
    const postMessage = vi.fn();
    (window as Window & { system: { postMessage: typeof postMessage } }).system = {
      postMessage,
    };
    postQuickAppMessage({ type: "ready" });
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "ready" }));
  });

  it("forwards shell messages and signals ready", () => {
    const postMessage = vi.fn();
    const system: {
      postMessage: typeof postMessage;
      onmessage: ((data: string) => void) | null;
    } = { postMessage, onmessage: null };
    (window as Window & { system: typeof system }).system = system;

    const received: unknown[] = [];
    const stop = subscribeQuickAppShell((message) => received.push(message));
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "ready" }));

    system.onmessage?.(JSON.stringify({ type: "oppo-push-regid", regId: "CN_1" }));
    expect(received).toEqual([{ type: "oppo-push-regid", regId: "CN_1" }]);
    stop();
  });
});
