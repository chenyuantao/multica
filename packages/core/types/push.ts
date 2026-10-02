export type PushPlatform = "webpush" | "jpush" | "oppo";

export interface PushConfigResponse {
  /** VAPID application server key. Empty when the server has no Web Push configured. */
  web_push_public_key: string;
  /** True when this deployment can register OPPO Quick App devices. */
  oppo_push_enabled: boolean;
}

export interface PushSubscriptionInput {
  platform: PushPlatform;
  /** Web Push endpoint URL, or the native provider's registration id. */
  token: string;
  keys?: { p256dh: string; auth: string };
}
