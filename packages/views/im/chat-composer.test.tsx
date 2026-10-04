// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Attachment } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { ChatComposer } from "./chat-composer";
import { VOICE_LONG_PRESS_MS, VOICE_TOUCH_SHIELD_MS } from "./voice-hold";
import { encodeDocExcerpt } from "./doc-excerpt";
import { DocExcerptInsertProvider, useInsertDocExcerpt } from "./doc-excerpt-insert";
import { DocExcerptRevealProvider } from "./doc-excerpt-reveal";

const uploadFile = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({
  api: { uploadFile },
  getApi: () => ({
    getToken: () => "token",
    getBaseUrl: () => "http://api.test",
    issueCliToken: vi.fn(),
  }),
}));
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

describe("ChatComposer enter", () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ["Shift", { shiftKey: true }],
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
  ] as const)("%s+Enter inserts a newline and does not send", (_label, modifiers) => {
    const onSend = renderComposer();
    setComposerText("hello");
    fireEvent.keyDown(composerBox(), { key: "Enter", ...modifiers });
    expect(onSend).not.toHaveBeenCalled();
    expect(composerBox().textContent).toBe("hello\n");
  });

  it("sends on Enter alone", () => {
    const onSend = renderComposer();
    setComposerText("hello");
    fireEvent.keyDown(composerBox(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello", []);
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
    const chips = [...composerBox().querySelectorAll("[data-doc-excerpt]")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["本周周报1", "本周周报2"]);
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

  it("opens the note when an excerpt chip is clicked", () => {
    const onOpen = vi.fn();
    function Harness() {
      const insert = useInsertDocExcerpt();
      return (
        <>
          <button
            type="button"
            onClick={() => insert("chat-1", { name: "本周周报", path: "notes/weekly.md", text: "周五发布", from: 4 })}
          >
            ask
          </button>
          <ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={vi.fn()} />
        </>
      );
    }
    renderWithI18n(
      <DocExcerptRevealProvider onOpen={onOpen}>
        <DocExcerptInsertProvider>
          <Harness />
        </DocExcerptInsertProvider>
      </DocExcerptRevealProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    fireEvent.click(composerBox().querySelector("[data-doc-excerpt]")!);
    expect(onOpen).toHaveBeenCalledWith({ path: "notes/weekly.md", name: "本周周报" });
  });
});

describe("ChatComposer voice", () => {
  const previousWidth = window.innerWidth;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    vi.useRealTimers();
  });

  function denyMicrophone() {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: "prompt" })) },
    });
    return getUserMedia;
  }

  function grantMicrophone(getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}))) {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: "granted" })) },
    });
    return getUserMedia;
  }

  it("holds the message field itself and keeps the send button", async () => {
    const getUserMedia = denyMicrophone();
    renderComposer();
    expect(screen.queryByRole("button", { name: "Hold to talk" })).toBeNull();
    expect(screen.getByText("Hold to talk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    fireEvent.pointerDown(composerBox(), { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Allow microphone access to dictate a message.");
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for microphone access without entering voice mode, then enters on the next hold", async () => {
    const stop = vi.fn();
    let resolveMedia: (stream: { getTracks: () => Array<{ stop: () => void }> }) => void = () => {};
    const getUserMedia = vi.fn(
      () => new Promise((resolve) => {
        resolveMedia = resolve;
      }),
    );
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: "prompt" })) },
    });
    renderComposer();
    fireEvent.pointerDown(composerBox(), { button: 0, clientX: 20, clientY: 40, pointerId: 1 });

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    resolveMedia({ getTracks: () => [{ stop }] });
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerUp(composerBox(), { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    await new Promise((resolve) => setTimeout(resolve, VOICE_TOUCH_SHIELD_MS + 40));
    getUserMedia.mockImplementation(() => new Promise(() => {}));
    fireEvent.pointerDown(composerBox(), { button: 0, clientX: 20, clientY: 40, pointerId: 2 });
    expect(await screen.findByRole("dialog", { name: "Release to send" })).toBeInTheDocument();
  });

  it("treats a short tap as typing", async () => {
    const getUserMedia = denyMicrophone();
    renderComposer();
    const box = composerBox();

    fireEvent.pointerDown(box, { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(box, { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    expect(box).toHaveFocus();
    await new Promise((resolve) => setTimeout(resolve, VOICE_LONG_PRESS_MS + 80));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores every control except cancel, edit, and release while the finger is down", async () => {
    const outside = vi.fn();
    grantMicrophone();
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const fileClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    try {
      renderWithI18n(
        <>
          <button type="button" onClick={outside}>Outside</button>
          <ChatComposer chatId="chat-1" chatTitle="Launch room" candidates={[]} onSend={vi.fn()} />
        </>,
      );
      fireEvent.pointerDown(composerBox(), { button: 0, clientX: 180, clientY: 40, pointerId: 1 });
      expect(await screen.findByRole("dialog", { name: "Release to send" })).toBeInTheDocument();

      fireEvent.pointerMove(window, { clientX: 20, clientY: 700, pointerId: 1 });
      expect(screen.getByRole("dialog", { name: "Release to cancel" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Outside" }));
      fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(outside).not.toHaveBeenCalled();
      expect(fileClick).not.toHaveBeenCalled();

      fireEvent.pointerMove(window, { clientX: 320, clientY: 700, pointerId: 1 });
      expect(screen.getByRole("dialog", { name: "Release to edit" })).toBeInTheDocument();

      fireEvent.pointerUp(window, { clientX: 20, clientY: 700, pointerId: 1 });
      fireEvent.click(screen.getByRole("button", { name: "Outside" }));
      expect(outside).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, VOICE_TOUCH_SHIELD_MS + 40));
      fireEvent.click(screen.getByRole("button", { name: "Outside" }));
      expect(outside).toHaveBeenCalledOnce();
    } finally {
      fileClick.mockRestore();
      Object.defineProperty(window, "innerHeight", { configurable: true, value: previousHeight });
    }
  });

  it("blocks text selection while the finger is down and restores the field after a tap", () => {
    renderComposer();
    const box = composerBox();
    fireEvent.pointerDown(box, { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    expect(box).toHaveAttribute("contenteditable", "false");
    expect(document.documentElement.style.userSelect).toBe("none");
    const select = new Event("selectstart", { bubbles: true, cancelable: true });
    window.dispatchEvent(select);
    expect(select.defaultPrevented).toBe(true);

    fireEvent.pointerUp(box, { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    expect(box).toHaveAttribute("contenteditable", "true");
    expect(box).toHaveFocus();
  });

  it("fills the cancel and edit blocks while the finger is in those zones", async () => {
    grantMicrophone();
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    try {
      renderComposer();
      fireEvent.pointerDown(composerBox(), { button: 0, clientX: 180, clientY: 40, pointerId: 1 });
      expect(await screen.findByRole("dialog", { name: "Release to send" })).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toHaveAttribute("data-active", "false");
      expect(screen.getByText("Edit")).toHaveAttribute("data-active", "false");

      fireEvent.pointerMove(window, { clientX: 20, clientY: 700, pointerId: 1 });
      expect(screen.getByText("Cancel")).toHaveAttribute("data-active", "true");
      expect(screen.getByText("Cancel").className).toContain("bg-red-500");
      expect(screen.getByText("Edit")).toHaveAttribute("data-active", "false");

      fireEvent.pointerMove(window, { clientX: 320, clientY: 700, pointerId: 1 });
      expect(screen.getByText("Edit")).toHaveAttribute("data-active", "true");
      expect(screen.getByText("Edit").className).toContain("bg-white");
      expect(screen.getByText("Cancel")).toHaveAttribute("data-active", "false");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: previousHeight });
    }
  });

  it("covers the screen with a dark scrim while holding", async () => {
    grantMicrophone();
    renderComposer();
    fireEvent.pointerDown(composerBox(), { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    const scrim = await screen.findByRole("dialog", { name: "Release to send" });
    expect(scrim.className).toContain("bg-black/90");
  });

  it("does not listen once the field has text", async () => {
    const getUserMedia = denyMicrophone();
    renderComposer();
    setComposerText("hello");
    expect(screen.queryByText("Hold to talk")).toBeNull();

    fireEvent.pointerDown(composerBox(), { button: 0, clientX: 20, clientY: 40, pointerId: 1 });
    await new Promise((resolve) => setTimeout(resolve, VOICE_LONG_PRESS_MS + 80));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});
