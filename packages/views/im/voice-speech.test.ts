// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SpeechSession, resampleToPCM16, speechRealtimeURL, type SpeechSocket } from "./voice-speech";

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
  it("maps an API origin onto the speech socket", () => {
    expect(speechRealtimeURL("https://api.example.test")).toBe(
      "wss://api.example.test/api/speech/realtime",
    );
    expect(speechRealtimeURL("http://localhost:8080/")).toBe(
      "ws://localhost:8080/api/speech/realtime",
    );
    expect(speechRealtimeURL("https://api.example.test/base")).toBe(
      "wss://api.example.test/base/api/speech/realtime",
    );
  });

  it("uses the page origin when the API base is same-origin", () => {
    expect(speechRealtimeURL("", "https://app.example.test")).toBe(
      "wss://app.example.test/api/speech/realtime",
    );
  });
});

describe("resampleToPCM16", () => {
  it("writes a full-scale sample as little-endian PCM16", () => {
    const pcm = resampleToPCM16(new Float32Array([1, -1]), 16000);
    expect(pcm).toEqual(new Uint8Array([0xff, 0x7f, 0x00, 0x80]));
  });

  it("downsamples a higher capture rate", () => {
    const pcm = resampleToPCM16(new Float32Array(48), 48000);
    expect(pcm.byteLength).toBe(32);
  });
});

describe("SpeechSession", () => {
  it("starts with the session token and surfaces partial then final text", async () => {
    const session = new SpeechSession(
      "ws://localhost/api/speech/realtime",
      "token-1",
      "",
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
      corpus: "",
    });
    socket.frame({ type: "ready" });
    await starting;
    const pcm = new Uint8Array([1, 2]);
    session.push(pcm);
    socket.frame({ type: "partial", text: "你好" });
    expect(partials).toEqual(["你好"]);
    const committed = session.commit();
    expect(JSON.parse(String(socket.sent.at(-1)))).toEqual({ type: "commit" });
    socket.frame({ type: "final", text: "你好世界" });
    await expect(committed).resolves.toBe("你好世界");
  });
});
