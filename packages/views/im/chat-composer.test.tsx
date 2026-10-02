// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Attachment } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatComposer } from "./chat-composer";
import { encodeDocExcerpt } from "./doc-excerpt";
import { DocExcerptInsertProvider, useInsertDocExcerpt } from "./doc-excerpt-insert";

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

function composerBox() {
  return screen.getByRole("textbox");
}

function setComposerText(value: string) {
  const box = composerBox();
  box.textContent = value;
  fireEvent.input(box);
}

function pickFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ChatComposer attachments", () => {
  beforeEach(() => {
    localStorage.clear();
    uploadFile.mockReset();
  });

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
    setComposerText("please review");

    pickFile(new File(["x"], "spec.pdf", { type: "application/pdf" }));
    fireEvent.keyDown(composerBox(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    finish(attachment("att-2", "spec.pdf", "application/pdf"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.keyDown(composerBox(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("please review\n\n[spec.pdf](https://cdn.test/spec.pdf)", ["att-2"]);
  });

  it("drops a removed attachment from the message", async () => {
    uploadFile.mockResolvedValue(attachment("att-3", "notes.txt", "text/plain"));
    const onSend = renderComposer();
    pickFile(new File(["x"], "notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remove attachment: notes.txt" }));
    setComposerText("hi");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("hi", []);
  });
});

describe("ChatComposer drafts", () => {
  beforeEach(() => localStorage.clear());

  it("restores unsent text for the same chat and leaves other chats alone", () => {
    const { rerender } = renderWithI18n(
      <ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={vi.fn()} />,
    );
    setComposerText("hold this");

    rerender(<ChatComposer chatId="chat-2" chatTitle="Other room" candidates={[]} onSend={vi.fn()} />);
    expect(composerBox()).toHaveTextContent("");
    setComposerText("other");

    rerender(<ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={vi.fn()} />);
    expect(composerBox()).toHaveTextContent("hold this");

    setComposerText("");
    rerender(<ChatComposer chatId="chat-2" chatTitle="Other room" candidates={[]} onSend={vi.fn()} />);
    rerender(<ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={vi.fn()} />);
    expect(composerBox()).toHaveTextContent("");
  });

  it("clears the stored draft after the message is sent", () => {
    const onSend = renderComposer();
    setComposerText("please review");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("please review", []);

    renderWithI18n(<ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={vi.fn()} />);
    expect(screen.getAllByRole("textbox").at(-1)).toHaveTextContent("");
  });
});

describe("ChatComposer quote", () => {
  beforeEach(() => localStorage.clear());

  it("shows the quote on one line and cancels it with the button or Escape", () => {
    const onCancelQuote = vi.fn();
    renderWithI18n(
      <ChatComposer
        chatId="chat-1"
        chatTitle="Launch room"
        candidates={[]}
        onSend={vi.fn()}
        quote={{ id: "m-1", name: "Ada", text: "Ship v2\non Friday" }}
        onCancelQuote={onCancelQuote}
      />,
    );
    expect(screen.getByText("Ada: Ship v2 on Friday")).toHaveClass("truncate");
    expect(composerBox()).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Cancel quote" }));
    fireEvent.keyDown(composerBox(), { key: "Escape" });
    expect(onCancelQuote).toHaveBeenCalledTimes(2);
  });
});

describe("ChatComposer document excerpts", () => {
  beforeEach(() => localStorage.clear());

  it("embeds each asked passage in the message, and a paste puts one back", () => {
    const onSend = vi.fn();
    function Harness() {
      const insert = useInsertDocExcerpt();
      return (
        <>
          <button
            type="button"
            onClick={() => insert("chat-1", { name: "本周周报", path: "notes/weekly.md", text: "周五发布" })}
          >
            ask
          </button>
          <ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={onSend} />
        </>
      );
    }
    renderWithI18n(
      <DocExcerptInsertProvider>
        <Harness />
      </DocExcerptInsertProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const weekly = encodeDocExcerpt({ name: "本周周报", path: "notes/weekly.md", text: "周五发布" });
    expect(onSend).toHaveBeenCalledWith(`${weekly} ${weekly}`, []);

    const box = composerBox();
    fireEvent.paste(box, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === "text/plain" ? `请看 ${weekly}` : ""),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenLastCalledWith(`请看 ${weekly}`, []);
    expect(box.querySelector("[data-doc-excerpt]")).toBeNull();
  });
});
