import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const ApiError = vi.hoisted(
  () =>
    class ApiError extends Error {
      constructor(
        message: string,
        readonly status: number,
      ) {
        super(message);
      }
    },
);

const api = vi.hoisted(() => ({
  getWechatClaw: vi.fn(),
  createWechatClawQRCode: vi.fn(),
  getWechatClawQRCodeStatus: vi.fn(),
  deleteWechatClaw: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({ api, ApiError }));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme", slug: "acme" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { WechatClawTab } from "./wechat-claw-tab";

const BINDING = {
  workspace_id: "ws-1",
  workspace_name: "Acme",
  workspace_slug: "acme",
  bound_at: "2026-10-04T00:00:00Z",
};

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en" resources={{ en: { common: enCommon, settings: enSettings } }}>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
  return render(<WechatClawTab />, { wrapper });
}

describe("WechatClawTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listWorkspaces.mockResolvedValue([
      { id: "ws-1", name: "Acme", slug: "acme" },
      { id: "ws-2", name: "Beta", slug: "beta" },
    ]);
  });

  it("explains that the deployment has not enabled the integration", async () => {
    api.getWechatClaw.mockResolvedValue({ available: false, binding: null });
    renderTab();

    expect(await screen.findByText(/MULTICA_WECHAT_CLAW_SECRET_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get QR code" })).not.toBeInTheDocument();
  });

  it("binds the current workspace after the QR code is scanned and confirmed", async () => {
    api.getWechatClaw
      .mockResolvedValueOnce({ available: true, binding: null })
      .mockResolvedValue({ available: true, binding: BINDING });
    api.createWechatClawQRCode.mockResolvedValue({ qrcode: "qr-1", url: "https://example.com/qr-1" });
    api.getWechatClawQRCodeStatus
      .mockResolvedValueOnce({ status: "scanned", binding: null })
      .mockResolvedValueOnce({ status: "confirmed", binding: BINDING });
    renderTab();

    const bind = await screen.findByRole("button", { name: "Get QR code" });
    await waitFor(() => expect(bind).toBeEnabled());
    await userEvent.click(bind);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("WeChat Claw bound"));
    expect(api.createWechatClawQRCode).toHaveBeenCalledWith("ws-1");
    expect(api.getWechatClawQRCodeStatus).toHaveBeenCalledWith("qr-1", expect.any(AbortSignal));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Bound workspace")).toBeInTheDocument();
  });

  it("offers a new code once the QR code expires", async () => {
    api.getWechatClaw.mockResolvedValue({ available: true, binding: null });
    api.createWechatClawQRCode.mockResolvedValue({ qrcode: "qr-1", url: "https://example.com/qr-1" });
    api.getWechatClawQRCodeStatus.mockResolvedValue({ status: "expired", binding: null });
    renderTab();

    const bind = await screen.findByRole("button", { name: "Get QR code" });
    await waitFor(() => expect(bind).toBeEnabled());
    await userEvent.click(bind);

    expect(await screen.findByText("This QR code has expired.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Get a new code" }));
    await waitFor(() => expect(api.createWechatClawQRCode).toHaveBeenCalledTimes(2));
  });

  it("unbinds only after confirmation", async () => {
    api.getWechatClaw.mockResolvedValue({ available: true, binding: BINDING });
    api.deleteWechatClaw.mockResolvedValue(undefined);
    renderTab();

    await userEvent.click(await screen.findByRole("button", { name: "Unbind" }));
    expect(api.deleteWechatClaw).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Unbind" }));

    await waitFor(() => expect(api.deleteWechatClaw).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
