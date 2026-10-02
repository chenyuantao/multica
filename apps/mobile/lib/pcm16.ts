/** PCM bytes ready to forward as a binary WebSocket frame. */
export function audioChunkToPCM16(
  data: string | Float32Array | Int16Array,
): Uint8Array | null {
  if (typeof data === "string") {
    if (!data) return null;
    return decodeBase64(data);
  }
  if (data instanceof Int16Array) {
    if (data.byteLength === 0) return null;
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Float32Array) {
    if (data.length === 0) return null;
    const out = new Uint8Array(data.length * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < data.length; i++) {
      const sample = Math.max(-1, Math.min(1, data[i] ?? 0));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return out;
  }
  return null;
}

function decodeBase64(input: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(input, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
