import { getApi } from "@multica/core/api";

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

/** Maps the API base onto the press-to-talk socket. An empty base is same-origin. */
export function speechRealtimeURL(apiBase: string, origin = typeof location !== "undefined" ? location.origin : ""): string {
  const trimmed = apiBase.trim().replace(/\/$/, "");
  const absolute = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${origin}${trimmed.startsWith("/") ? trimmed : trimmed ? `/${trimmed}` : ""}`;
  return `${absolute.replace(/^http/i, "ws")}/api/speech/realtime`;
}

/** Linear resample of mono float samples into little-endian PCM16. */
export function resampleToPCM16(samples: Float32Array, fromRate: number, toRate = 16000): Uint8Array {
  if (samples.length === 0 || !(fromRate > 0) || !(toRate > 0)) return new Uint8Array();
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Uint8Array(length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const index = Math.min(Math.floor(pos), samples.length - 1);
    const next = Math.min(index + 1, samples.length - 1);
    const frac = pos - index;
    const mixed = (samples[index] ?? 0) + ((samples[next] ?? 0) - (samples[index] ?? 0)) * frac;
    const sample = Math.max(-1, Math.min(1, mixed));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return out;
}

/**
 * Cookie sessions have no bearer token in JS. The speech socket authenticates
 * the first frame, so a browser asks the existing session endpoint for one.
 */
export async function resolveSpeechToken(): Promise<string> {
  const api = getApi();
  const current = api.getToken();
  if (current) return current;
  const issued = await api.issueCliToken();
  return issued.token;
}

/**
 * One press-to-talk session. The page sends PCM; the server forwards it and
 * returns partial then final transcripts.
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
        socket.send(JSON.stringify({
          type: "start",
          token: this.token,
          language: "zh",
          corpus: this.corpus,
        }));
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

type ScriptProcessor = {
  onaudioprocess: ((event: { inputBuffer: AudioBuffer }) => void) | null;
  connect: (node: AudioNode) => void;
  disconnect: () => void;
};

export type MicrophonePermission = "granted" | "denied" | "prompt" | "unknown";

/** `granted` can start voice mode. `prompt` and `unknown` still need a browser request. */
export async function readMicrophonePermission(): Promise<MicrophonePermission> {
  const query = navigator.permissions?.query;
  if (!query) return "unknown";
  try {
    const status = await query.call(navigator.permissions, { name: "microphone" as PermissionName });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") return status.state;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function microphonePermissionDenied(err: unknown): boolean {
  const name = err instanceof DOMException ? err.name : "";
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

/**
 * Asks the browser for microphone access and releases the stream immediately.
 * The grant itself is what the next press needs; this call does not record.
 */
export async function requestMicrophonePermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** Opens the microphone and emits 16 kHz PCM16 chunks until the caller stops it. */
export async function capturePCM16(onChunk: (pcm: Uint8Array) => void): Promise<() => Promise<void>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = (context as AudioContext & {
    createScriptProcessor: (size: number, inputs: number, outputs: number) => ScriptProcessor;
  }).createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    const pcm = resampleToPCM16(event.inputBuffer.getChannelData(0), context.sampleRate);
    if (pcm.byteLength > 0) onChunk(pcm);
  };
  source.connect(processor as unknown as AudioNode);
  processor.connect(context.destination);
  return async () => {
    processor.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    await context.close();
  };
}
