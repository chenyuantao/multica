// @vitest-environment node

import { describe, expect, it } from "vitest";
import { audioChunkToPCM16 } from "./pcm16";

describe("audioChunkToPCM16", () => {
  it("decodes base64 PCM from the native recorder", () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    const pcm = audioChunkToPCM16(Buffer.from(raw).toString("base64"));
    expect(pcm).toEqual(raw);
  });

  it("converts float samples to little-endian int16", () => {
    const pcm = audioChunkToPCM16(new Float32Array([0, 1, -1]));
    expect(pcm).toEqual(new Uint8Array([0, 0, 0xff, 0x7f, 0x00, 0x80]));
  });
});
