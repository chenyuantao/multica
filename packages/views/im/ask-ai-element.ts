import type { AskAIElement, AskAILocation } from "@multica/core/types";

// The server clamps to the same limits; cutting here keeps the request small.
const MAX_CONTENT = 8000;
const MAX_FIELD = 1000;
const MAX_ENTRIES = 50;
const MAX_IMAGES = 20;

function cut(s: string, n: number): [string, boolean] {
  if (s.length <= n) return [s, false];
  return [Array.from(s).slice(0, n).join(""), true];
}

function entries(list: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of list) {
    if (count++ === MAX_ENTRIES) break;
    out[cut(k, MAX_FIELD)[0]] = cut(v, MAX_FIELD)[0];
  }
  return out;
}

function escapeIdent(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s;
}

/** A CSS path from the body that stops at the nearest ancestor with an id. */
function selectorOf(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node && node !== el.ownerDocument.documentElement; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${tag}#${escapeIdent(node.id)}`);
      break;
    }
    const slot = node.getAttribute("data-slot");
    let part = slot ? `${tag}[data-slot="${slot}"]` : tag;
    const siblings = node.parentElement ? Array.from(node.parentElement.children) : [];
    const same = siblings.filter((s) => s.tagName === node!.tagName);
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    parts.unshift(part);
  }
  return parts.join(" > ");
}

function visibleText(el: Element): string {
  const raw = (el instanceof HTMLElement ? el.innerText : undefined) ?? el.textContent ?? "";
  return raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Images inside the element; `data:` and `blob:` sources only work on this device, so only their alt text goes. */
function imagesOf(el: Element): AskAIElement["images"] {
  const imgs = [el, ...Array.from(el.querySelectorAll("img"))].filter(
    (node): node is HTMLImageElement => node instanceof HTMLImageElement,
  );
  const out: AskAIElement["images"] = [];
  for (const img of imgs) {
    if (out.length === MAX_IMAGES) break;
    const raw = img.currentSrc || img.src;
    const src = /^https?:/i.test(raw) ? cut(raw, MAX_FIELD)[0] : "";
    const alt = cut(img.alt, MAX_FIELD)[0];
    if (src || alt) out.push({ src, alt });
  }
  return out;
}

interface PageLocation {
  pathname: string;
  searchParams: URLSearchParams;
}

/** The URL path and query parameters of the current page. */
export function describeLocation(location: PageLocation): AskAILocation {
  return { path: cut(location.pathname, MAX_FIELD)[0], params: entries(location.searchParams.entries()) };
}

/** Describes a picked DOM node together with the page it is on. */
export function describeElement(el: Element, location: PageLocation): AskAIElement {
  const [html, cutHtml] = cut(el.outerHTML, MAX_CONTENT);
  const [text, cutText] = cut(visibleText(el), MAX_CONTENT);
  return {
    ...describeLocation(location),
    tag: el.tagName.toLowerCase(),
    selector: cut(selectorOf(el), MAX_FIELD)[0],
    attributes: entries(Array.from(el.attributes, (a) => [a.name, a.value] as [string, string])),
    html,
    text,
    images: imagesOf(el),
    truncated: cutHtml || cutText,
  };
}

/** One line naming a picked element in the quote above the input. */
export function elementLabel(e: AskAIElement): string {
  const name =
    e.text.replace(/\s+/g, " ").trim() ||
    e.images.find((i) => i.alt)?.alt ||
    e.attributes["aria-label"] ||
    e.attributes.title ||
    "";
  return name ? `<${e.tag}> ${name}` : e.selector;
}
