import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import type { IMindPrompts } from "@multica/core/api/schemas";
import enSettings from "../../locales/en/settings.json";

const api = vi.hoisted(() => ({ getIMindPrompts: vi.fn(), setIMindPrompt: vi.fn() }));
vi.mock("@multica/core/api", () => ({ api }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { IMindPromptSettings } from "./imind-prompt-settings";

const defaults: IMindPrompts = { prompts: [{ kind: "file_title", defaultTemplate: "Default {{FILE_CONTENT}}", template: "Default {{FILE_CONTENT}}", custom: false }], variables: ["FILE_CONTENT", "FILE_PATH"] };
function mount(canManage = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}><I18nProvider locale="en" resources={{ en: { settings: enSettings } }}>{children}</I18nProvider></QueryClientProvider>;
  }
  return render(<IMindPromptSettings wsId="workspace" canManage={canManage} />, { wrapper: Wrapper });
}

beforeEach(() => { vi.clearAllMocks(); api.getIMindPrompts.mockResolvedValue(defaults); });
afterEach(cleanup);

describe("iMind prompt settings", () => {
  it("shows the actual default in the editor, saves an override and restores the server default", async () => {
    mount();
    const editor = await screen.findByLabelText("File title (DeepSeek)");
    expect(editor).toHaveValue("Default {{FILE_CONTENT}}");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(editor, { target: { value: "Custom {{FILE_PATH}}" } });
    api.setIMindPrompt.mockResolvedValueOnce({ ...defaults, prompts: [{ ...defaults.prompts[0], template: "Custom {{FILE_PATH}}", custom: true }] });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setIMindPrompt).toHaveBeenCalledWith("file_title", "Custom {{FILE_PATH}}"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
    api.setIMindPrompt.mockResolvedValueOnce(defaults);
    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));
    await waitFor(() => expect(editor).toHaveValue("Default {{FILE_CONTENT}}"));
    expect(api.setIMindPrompt).toHaveBeenLastCalledWith("file_title", null);
    fireEvent.click(screen.getByText("Template variables"));
    expect(screen.getByText("{{FILE_CONTENT}}")).toBeVisible();
  });
  it("preserves edits after a failed save and prevents blank submission", async () => {
    mount();
    const editor = await screen.findByLabelText("File title (DeepSeek)");
    fireEvent.change(editor, { target: { value: "Unsaved draft" } });
    api.setIMindPrompt.mockRejectedValueOnce(new Error("Unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(editor).toHaveValue("Unsaved draft");
    fireEvent.change(editor, { target: { value: " " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("shows templates read-only to members without management permission", async () => {
    mount(false);
    expect(await screen.findByLabelText("File title (DeepSeek)")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
