export type SpeechSocket = {
  readyState: number;
  send: (data: string | ArrayBuffer) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
};

export type SpeechSocketFactory = new (url: string) => SpeechSocket;

const OPEN = 1;

export function speechRealtimeURL(apiURL: string): string {
  return `${apiURL.replace(/\/$/, "").replace(/^http/, "ws")}/api/speech/realtime`;
}

/**
 * One press-to-talk session. The phone sends PCM; the server forwards it to
 * DashScope and returns partial then final transcripts.
 */
export class SpeechSession {
  private socket: SpeechSocket | null = null;
  private partial = "";
  private ready: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private finalWait: { resolve: (text: string) => void } | null = null;
  onPartial: (text: string) => void = () => {};

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly corpus: string,
    private readonly Socket: SpeechSocketFactory = WebSocket as unknown as SpeechSocketFactory,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new this.Socket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("speech session timed out"));
      }, 8000);
      this.ready = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            token: this.token,
            language: "zh",
            corpus: this.corpus,
          }),
        );
      };
      socket.onmessage = (event) => this.onFrame(event.data);
      socket.onerror = () => {
        this.ready?.reject(new Error("speech session failed"));
        this.ready = null;
      };
    });
  }

  push(pcm: Uint8Array) {
    if (!this.socket || this.socket.readyState !== OPEN || pcm.byteLength === 0) return;
    const copy = new ArrayBuffer(pcm.byteLength);
    new Uint8Array(copy).set(pcm);
    this.socket.send(copy);
  }

  commit(): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.partial.trim()), 4000);
      this.finalWait = {
        resolve: (text) => {
          clearTimeout(timer);
          resolve(text.trim());
        },
      };
      this.socket?.send(JSON.stringify({ type: "commit" }));
    });
  }

  cancel() {
    this.socket?.send(JSON.stringify({ type: "cancel" }));
    this.socket?.close();
    this.socket = null;
  }

  private onFrame(data: unknown) {
    if (typeof data !== "string") return;
    let msg: { type?: string; text?: string; message?: string };
    try {
      msg = JSON.parse(data) as { type?: string; text?: string; message?: string };
    } catch {
      return;
    }
    if (msg.type === "ready") {
      this.ready?.resolve();
      this.ready = null;
      return;
    }
    if (msg.type === "partial" && msg.text) {
      this.partial = msg.text;
      this.onPartial(msg.text);
      return;
    }
    if (msg.type === "final") {
      this.partial = msg.text || this.partial;
      this.finalWait?.resolve(this.partial);
      this.finalWait = null;
      return;
    }
    if (msg.type === "error") {
      this.ready?.reject(new Error(msg.message || "speech session failed"));
      this.ready = null;
      this.finalWait?.resolve(this.partial);
      this.finalWait = null;
    }
  }
}
