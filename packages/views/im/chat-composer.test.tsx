// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Attachment } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatComposer } from "./chat-composer";

const uploadFile = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({ api: { uploadFile } }));
vi.mock("../common/actor-avatar", () => ({ ActorAvatar: () => null }));

function attachment(id: string, filename: string, contentType: string): Attachment {
  return {
    id,
    workspace_id: "ws-1",
    issue_id: "chat-1",
    comment_id: null,
    uploader_type: "member",
    uploader_id: "user-1",
    filename,
    url: `https://cdn.test/${filename}`,
    markdown_url: `https://cdn.test/${filename}`,
    download_url: `https://cdn.test/${filename}`,
    content_type: contentType,
    size_bytes: 1,
    created_at: "2026-09-30T00:00:00Z",
  } as Attachment;
}

function renderComposer() {
  const onSend = vi.fn();
  renderWithI18n(<ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={onSend} />);
  return onSend;
}

function pickFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ChatComposer attachments", () => {
  beforeEach(() => uploadFile.mockReset());

  it("sends an attachment on its own, bound to the chat", async () => {
    uploadFile.mockResolvedValue(attachment("att-1", "shot.png", "image/png"));
    const onSend = renderComposer();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    pickFile(new File(["x"], "shot.png", { type: "image/png" }));
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ issueId: "chat-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("![shot.png](https://cdn.test/shot.png)", ["att-1"]);
    expect(screen.queryByText("shot.png")).toBeNull();
  });

  it("appends attachments after the text and blocks sending while uploading", async () => {
    let finish: (a: Attachment) => void = () => {};
    uploadFile.mockReturnValue(new Promise<Attachment>((resolve) => (finish = resolve)));
    const onSend = renderComposer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "please review" } });

    pickFile(new File(["x"], "spec.pdf", { type: "application/pdf" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    finish(attachment("att-2", "spec.pdf", "application/pdf"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("please review\n\n[spec.pdf](https://cdn.test/spec.pdf)", ["att-2"]);
  });

  it("drops a removed attachment from the message", async () => {
    uploadFile.mockResolvedValue(attachment("att-3", "notes.txt", "text/plain"));
    const onSend = renderComposer();
    pickFile(new File(["x"], "notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remove attachment: notes.txt" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("hi", []);
  });
});
