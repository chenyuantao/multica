/** A passage selected in a knowledge note and embedded in a chat message. */
export interface DocExcerpt {
  name: string;
  path: string;
  text: string;
}

const NAME_MAX = 200;
const PATH_MAX = 1024;
const TEXT_MAX = 4000;
const LABEL_MAX = 80;

const TOKEN = /\[([^\]]*)\]\(doc-excerpt:\/\/([A-Za-z0-9_-]+)\)/g;

export type DocExcerptPart =
  | { kind: "text"; text: string }
  | { kind: "excerpt"; excerpt: DocExcerpt };

function clipRunes(value: string, max: number): string {
  const runes = [...value];
  return runes.length <= max ? value : runes.slice(0, max).join("");
}

function cleanMeta(value: string, max: number): string {
  return clipRunes(value.replaceAll("\u0000", "").replace(/\s+/g, " ").trim(), max);
}

/** Drops an excerpt that has no document or no passage. Caps each field. */
export function normalizeDocExcerpt(excerpt: DocExcerpt): DocExcerpt | null {
  const name = cleanMeta(excerpt.name, NAME_MAX);
  const path = cleanMeta(excerpt.path, PATH_MAX);
  const text = clipRunes(excerpt.text.replaceAll("\u0000", "").trim(), TEXT_MAX);
  if (!name || !path || !text) return null;
  return { name, path, text };
}

/** One-line preview used as the markdown link label. `]` would break the link. */
export function docExcerptLabel(excerpt: DocExcerpt): string {
  const label = clipRunes(excerpt.text.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim(), LABEL_MAX);
  return label || "…";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(payload: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  try {
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Payload carried on the chip and in the `doc-excerpt://` link. */
export function encodeDocExcerptPayload(excerpt: DocExcerpt): string | null {
  const normalized = normalizeDocExcerpt(excerpt);
  if (!normalized) return null;
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(normalized)));
}

export function decodeDocExcerptPayload(payload: string): DocExcerpt | null {
  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.path !== "string" || typeof record.text !== "string") {
      return null;
    }
    return normalizeDocExcerpt({ name: record.name, path: record.path, text: record.text });
  } catch {
    return null;
  }
}

/** Markdown link the message stores. The label is a preview; the payload has the passage. */
export function encodeDocExcerpt(excerpt: DocExcerpt): string | null {
  const normalized = normalizeDocExcerpt(excerpt);
  const payload = normalized ? encodeDocExcerptPayload(normalized) : null;
  if (!normalized || !payload) return null;
  return `[${docExcerptLabel(normalized)}](doc-excerpt://${payload})`;
}

/** Splits a message into prose and the passages embedded in it, in order. */
export function splitDocExcerpts(markdown: string): DocExcerptPart[] {
  const parts: DocExcerptPart[] = [];
  const pattern = new RegExp(TOKEN.source, "g");
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: markdown.slice(last, index) });
    const excerpt = decodeDocExcerptPayload(match[2] ?? "");
    parts.push(excerpt ? { kind: "excerpt", excerpt } : { kind: "text", text: match[0] });
    last = index + match[0].length;
  }
  if (last < markdown.length || parts.length === 0) parts.push({ kind: "text", text: markdown.slice(last) });
  return parts;
}

/** The passages as plain text, so previews do not show the link payload. */
export function docExcerptPlain(markdown: string): string {
  return splitDocExcerpts(markdown)
    .map((part) => (part.kind === "text" ? part.text : part.excerpt.text))
    .join("");
}
