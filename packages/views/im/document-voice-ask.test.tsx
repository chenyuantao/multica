// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@multica/core/api";
import { docsKeys } from "@multica/core/docs";
import type { DocFile } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { DocumentVoiceAsk } from "./document-voice-ask";

const askMutate = vi.hoisted(() => vi.fn());
const sendMutateAsync = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const voice = vi.hoisted(() => ({
  onSend: (_text: string) => {},
  onEdit: (_text: string) => {},
}));

vi.mock("./voice-hold", () => ({
  useVoiceHold: (opts: { onSend: (text: string) => void; onEdit: (text: string) => void }) => {
    voice.onSend = opts.onSend;
    voice.onEdit = opts.onEdit;
    return {
      onPointerDown: () => {},
      onTouchStart: () => {},
      onPointerMove: () => {},
      onPointerUp: () => false,
      onPointerCancel: () => {},
      onContextMenu: () => {},
      capturing: false,
      overlay: null,
    };
  },
}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/group-chats", () => ({
  useAskAI: () => ({ mutate: askMutate, isPending: false }),
  useSendGroupChatMessage: () => ({ mutateAsync: sendMutateAsync, isPending: false }),
}));
vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ imChat: (id: string) => `/acme/im?chat=${id}` }),
}));
vi.mock("../navigation", () => ({ useNavigation: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const file: DocFile = {
  path: "notes/weekly.md",
  name: "weekly.md",
  content: "# Weekly\n周五发布\n",
  modified_at: "2026-10-01T00:00:00Z",
  revision: "r1",
};

const notePage = {
  note: {
    title: "weekly",
    path: "notes/weekly.md",
    modified_at: "2026-10-01T00:00:00Z",
    content: "# Weekly\n周五发布\n",
    truncated: false,
  },
};

function renderBar(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(docsKeys.file(file.path), file);
  return renderWithI18n(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("DocumentVoiceAsk", () => {
  beforeEach(() => {
    askMutate.mockReset();
    sendMutateAsync.mockReset();
    push.mockReset();
    toastError.mockReset();
  });

  it("shows a hold-to-talk button", () => {
    renderBar(<DocumentVoiceAsk path={file.path} />);
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
  });

  it("starts an Ask AI chat about the open note", () => {
    askMutate.mockImplementation((_vars: unknown, opts: { onSuccess?: (result: { chat: { id: string } }) => void }) => {
      opts.onSuccess?.({ chat: { id: "direct-1" } });
    });
    renderBar(<DocumentVoiceAsk path={file.path} />);

    act(() => {
      voice.onSend("总结一下");
    });

    expect(askMutate).toHaveBeenCalledWith({ query: "总结一下", page: notePage }, expect.any(Object));
    expect(sendMutateAsync).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/acme/im?chat=direct-1");
  });

  it("sends a group message with the note when the document was opened from a chat", async () => {
    sendMutateAsync.mockResolvedValue({ id: "m1" });
    const onSent = vi.fn();
    renderBar(<DocumentVoiceAsk path={file.path} name="本周周报" chatId="chat-1" onSent={onSent} />);

    act(() => {
      voice.onSend("这周做了什么");
    });
    await waitFor(() => expect(onSent).toHaveBeenCalled());

    expect(sendMutateAsync).toHaveBeenCalledWith({
      content: "这周做了什么",
      focusNote: { name: "本周周报", path: file.path },
      page: notePage,
    });
    expect(askMutate).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("lets a spoken line be edited before it is asked", () => {
    renderBar(<DocumentVoiceAsk path={file.path} />);

    act(() => {
      voice.onEdit("总结一下\u0000");
    });

    const field = screen.getByRole("textbox", { name: "Edit" });
    expect(field).toHaveValue("总结一下");
    fireEvent.change(field, { target: { value: "改成三点" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(askMutate).toHaveBeenCalledWith({ query: "改成三点", page: notePage }, expect.any(Object));
  });

  it("reports when no agent can answer", () => {
    askMutate.mockImplementation((_vars: unknown, opts: { onError?: (err: unknown) => void }) => {
      opts.onError?.(new ApiError("no", 422, "Unprocessable Entity", { code: "ask_ai_no_agent" }));
    });
    renderBar(<DocumentVoiceAsk path={file.path} />);

    act(() => {
      voice.onSend("总结一下");
    });

    expect(toastError).toHaveBeenCalledWith("There's no agent you can message.");
    expect(push).not.toHaveBeenCalled();
  });
});
