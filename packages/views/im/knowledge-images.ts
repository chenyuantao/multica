import { docAssetSrc, parseDocAssetSrc } from "../editor/utils/doc-asset";
import { parentDir } from "./knowledge-utils";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const WIKI_IMAGE = /!\[\[([^\]\n]+)\]\]/g;
const MD_IMAGE = /!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/g;
const DOC_ASSET_IMAGE = /!\[((?:\\.|[^\]\\])*)\]\(<?doc-asset:([A-Za-z0-9_%-]+)>?\)/g;

/**
 * The first path segment is the machine that shares the vault, and that
 * machine's directory is the vault root. `![[Images/a.png]]` is that root
 * plus `Images/a.png`, not the folder that contains the open note.
 * A target that starts with `./` or `../` is relative to the note instead.
 */
export function resolveVaultImage(notePath: string, target: string): string | null {
  const root = machineRoot(notePath);
  if (!root) return null;
  const file = imageFile(target);
  if (!file) return null;
  const explicit = file.startsWith("./") || file.startsWith("../");
  const base = explicit ? parentDir(notePath) : root;
  if (!base || (explicit && !base.startsWith(root))) return null;
  const joined = joinSegments(base, file);
  if (!joined || !joined.startsWith(`${root}/`)) return null;
  if (joined.split("/").some((part) => part.startsWith("."))) return null;
  return joined;
}

/** Turns vault image embeds into editor image syntax that loads the file bytes. */
export function expandVaultImages(notePath: string, markdown: string): string {
  return mapProse(markdown, (text) => {
    const withWiki = text.replace(WIKI_IMAGE, (full, inner: string) => {
      const path = resolveVaultImage(notePath, inner);
      if (!path) return full;
      const name = path.slice(path.lastIndexOf("/") + 1);
      return `![${escapeAlt(name)}](${docAssetSrc({ path, raw: inner, kind: "wiki" })})`;
    });
    return withWiki.replace(MD_IMAGE, (full, alt: string, src: string) => {
      if (!isRelativeImage(src)) return full;
      const path = resolveVaultImage(notePath, src);
      if (!path) return full;
      return `![${alt}](${docAssetSrc({ path, raw: src, kind: "md" })})`;
    });
  });
}

/** Writes editor image tokens back to the embeds stored in the note. */
export function collapseVaultImages(markdown: string): string {
  return markdown.replace(DOC_ASSET_IMAGE, (full, alt: string, payload: string) => {
    const ref = parseDocAssetSrc(`doc-asset:${payload}`);
    if (!ref) return full;
    if (ref.kind === "wiki") return `![[${ref.raw}]]`;
    return `![${alt}](${ref.raw})`;
  });
}

function machineRoot(notePath: string): string {
  const slash = notePath.indexOf("/");
  return slash < 0 ? "" : notePath.slice(0, slash);
}

function imageFile(target: string): string | null {
  const cut = target.split(/[|#]/, 1)[0]?.trim() ?? "";
  const file = (cut.split(/[?#]/)[0] ?? "").replaceAll("\\", "/").trim();
  if (!file || file.startsWith("/") || file.includes("\0")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(file)) return null;
  if (!IMAGE_EXT.test(file)) return null;
  return file;
}

function isRelativeImage(src: string): boolean {
  return imageFile(src) != null && !src.startsWith("doc-asset:");
}

function joinSegments(base: string, rel: string): string | null {
  const parts = base.split("/").filter((part) => part.length > 0);
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function escapeAlt(text: string): string {
  return text.replace(/[[\]\\()]/g, (ch) => `\\${ch}`);
}

/** Leaves fenced and inline code untouched so an example of the syntax stays text. */
function mapProse(markdown: string, map: (text: string) => string): string {
  let out = "";
  let i = 0;
  while (i < markdown.length) {
    const fence = fenceAt(markdown, i);
    if (fence) {
      out += markdown.slice(i, fence);
      i = fence;
      continue;
    }
    if (markdown.startsWith("`", i)) {
      const end = markdown.indexOf("`", i + 1);
      if (end !== -1 && !markdown.slice(i + 1, end).includes("\n")) {
        out += markdown.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    let next = markdown.length;
    const nextFence = indexOfLineFence(markdown, i + 1);
    const nextTick = markdown.indexOf("`", i + 1);
    if (nextFence !== -1) next = Math.min(next, nextFence);
    if (nextTick !== -1) next = Math.min(next, nextTick);
    out += map(markdown.slice(i, next));
    i = next;
  }
  return out;
}

function fenceAt(markdown: string, i: number): number | null {
  if (i !== 0 && markdown[i - 1] !== "\n") return null;
  const marker = markdown.startsWith("```", i) ? "```" : markdown.startsWith("~~~", i) ? "~~~" : "";
  if (!marker) return null;
  const lineEnd = markdown.indexOf("\n", i);
  const contentStart = lineEnd === -1 ? markdown.length : lineEnd + 1;
  const close = markdown.indexOf(`\n${marker}`, contentStart);
  if (close === -1) return markdown.length;
  return close + 1 + marker.length;
}

function indexOfLineFence(markdown: string, from: number): number {
  for (let i = from; i < markdown.length; i++) {
    if ((markdown.startsWith("```", i) || markdown.startsWith("~~~", i)) && (i === 0 || markdown[i - 1] === "\n")) {
      return i;
    }
  }
  return -1;
}
