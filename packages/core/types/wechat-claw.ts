/** The workspace a user's WeChat Claw is bound to. Wire shape mirrors
 * `WechatClawBindingResponse` in `server/internal/handler/wechat_claw.go`. */
export interface WechatClawBinding {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  bound_at: string;
}

export interface WechatClawStatus {
  /** False when the deployment has no WeChat Claw key configured. */
  available: boolean;
  binding: WechatClawBinding | null;
}

export interface WechatClawQRCode {
  qrcode: string;
  /** What the QR encodes; WeChat opens it when scanned. */
  url: string;
}

export type WechatClawLoginStatus = "wait" | "scanned" | "confirmed" | "expired";

export interface WechatClawQRCodeStatus {
  status: WechatClawLoginStatus;
  binding?: WechatClawBinding | null;
}
