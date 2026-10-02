// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SpeechSession, speechRealtimeURL, type SpeechSocket } from "./speech-session";

class FakeSocket implements SpeechSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  frame(body: unknown) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
}

describe("speechRealtimeURL", () => {
  it("maps the API origin onto the speech socket", () => {
    expect(speechRealtimeURL("https://api.example.test")).toBe(
      "wss://api.example.test/api/speech/realtime",
    );
    expect(speechRealtimeURL("http://localhost:8080/")).toBe(
      "ws://localhost:8080/api/speech/realtime",
    );
  });
});

describe("SpeechSession", () => {
  it("starts with the session token and surfaces partial then final text", async () => {
    const session = new SpeechSession(
      "ws://localhost/api/speech/realtime",
      "token-1",
      "Ada",
      FakeSocket as unknown as new (url: string) => SpeechSocket,
    );
    const partials: string[] = [];
    session.onPartial = (text) => partials.push(text);
    const starting = session.start();
    const socket = FakeSocket.last;
    if (!socket) throw new Error("socket was not created");
    socket.open();
    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: "start",
      token: "token-1",
      language: "zh",
      corpus: "Ada",
    });
    socket.frame({ type: "ready" });
    await starting;
    socket.frame({ type: "partial", text: "你好" });
    expect(partials).toEqual(["你好"]);
    const committed = session.commit();
    expect(JSON.parse(String(socket.sent.at(-1)))).toEqual({ type: "commit" });
    socket.frame({ type: "final", text: "你好世界" });
    await expect(committed).resolves.toBe("你好世界");
  });
});
