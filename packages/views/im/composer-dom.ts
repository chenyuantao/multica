import {
  decodeDocExcerptPayload,
  docExcerptChipLabels,
  encodeDocExcerpt,
  splitDocExcerpts,
  type DocExcerpt,
} from "./doc-excerpt";
import { DOC_EXCERPT_ATTR, createExcerptChip, setExcerptChipLabel } from "./doc-excerpt-chip";

/** Reads the editor as the markdown the message stores: prose plus excerpt links. */
export function serializeComposer(root: Node): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replaceAll("\u00a0", " ");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const payload = node.getAttribute(DOC_EXCERPT_ATTR);
    if (payload != null) {
      const excerpt = decodeDocExcerptPayload(payload);
      out += excerpt ? (encodeDocExcerpt(excerpt) ?? "") : (node.textContent ?? "");
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && out.length > 0 && !out.endsWith("\n")) out += "\n";
    for (const child of node.childNodes) walk(child);
  };
  if (root instanceof HTMLElement && root.hasAttribute(DOC_EXCERPT_ATTR)) {
    walk(root);
    return out;
  }
  for (const child of root.childNodes) walk(child);
  return out;
}

/** Replaces the editor contents with prose and atomic excerpt chips. */
export function renderComposer(root: HTMLElement, markdown: string): void {
  root.replaceChildren();
  for (const node of nodesFromMarkdown(markdown)) root.appendChild(node);
  labelComposerExcerpts(root);
}

/** The excerpt under a click or pointer event, when it landed on a chip. */
export function excerptFromComposerEvent(root: HTMLElement, target: EventTarget | null): DocExcerpt | null {
  if (!(target instanceof Node) || !root.contains(target)) return null;
  const el = target instanceof Element ? target : target.parentElement;
  const chip = el?.closest(`[${DOC_EXCERPT_ATTR}]`);
  if (!(chip instanceof HTMLElement) || !root.contains(chip)) return null;
  return decodeDocExcerptPayload(chip.getAttribute(DOC_EXCERPT_ATTR) ?? "");
}

/** Chips show the document name. A repeated name gets a 1-based suffix, in order. */
export function labelComposerExcerpts(root: HTMLElement): void {
  const chips = [...root.querySelectorAll(`[${DOC_EXCERPT_ATTR}]`)].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  const names = chips.map(
    (chip) => decodeDocExcerptPayload(chip.getAttribute(DOC_EXCERPT_ATTR) ?? "")?.name ?? "",
  );
  const labels = docExcerptChipLabels(names);
  chips.forEach((chip, i) => {
    const label = labels[i];
    if (label) setExcerptChipLabel(chip, label);
  });
}

export function nodesFromMarkdown(markdown: string): Node[] {
  const nodes: Node[] = [];
  for (const part of splitDocExcerpts(markdown)) {
    if (part.kind === "text") {
      if (part.text) nodes.push(document.createTextNode(part.text));
      continue;
    }
    const chip = createExcerptChip(part.excerpt);
    if (chip) nodes.push(chip);
  }
  return nodes;
}

function placeCaret(node: Node, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretAfter(node: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Caret offset in the serialized markdown. A chip counts as its whole link. */
export function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return serializeComposer(root).length;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  return serializeComposer(holder).length;
}

/** Moves the caret to an offset in the serialized markdown. A chip is atomic. */
export function setComposerCaret(root: HTMLElement, offset: number): void {
  let remaining = Math.max(0, offset);
  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        placeCaret(node, remaining);
        return true;
      }
      remaining -= len;
      return false;
    }
    if (node instanceof HTMLElement && node.hasAttribute(DOC_EXCERPT_ATTR)) {
      const len = serializeComposer(node).length;
      if (remaining <= len) {
        placeCaretAfter(node);
        return true;
      }
      remaining -= len;
      return false;
    }
    if (node instanceof HTMLBRElement) {
      if (remaining <= 1) {
        placeCaretAfter(node);
        return true;
      }
      remaining -= 1;
      return false;
    }
    for (const child of node.childNodes) {
      if (walk(child)) return true;
    }
    return false;
  };
  for (const child of root.childNodes) {
    if (walk(child)) return;
  }
  placeCaret(root, root.childNodes.length);
}

function insertNodes(root: HTMLElement, nodes: Node[]) {
  if (nodes.length === 0) return;
  const sel = window.getSelection();
  let range: Range | null = null;
  if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) range = sel.getRangeAt(0).cloneRange();
  root.focus();
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.appendChild(node);
  const last = nodes[nodes.length - 1]!;
  range.insertNode(fragment);
  labelComposerExcerpts(root);
  if (last.nodeType === Node.TEXT_NODE) placeCaret(last, last.textContent?.length ?? 0);
  else placeCaretAfter(last);
}

/** Inserts the passage at the caret as one chip, then a space so typing can continue. */
export function insertComposerExcerpt(root: HTMLElement, excerpt: DocExcerpt): boolean {
  const chip = createExcerptChip(excerpt);
  if (!chip) return false;
  insertNodes(root, [chip, document.createTextNode(" ")]);
  return true;
}

function neighbor(root: HTMLElement, dir: -1 | 1): Node | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const { startContainer, startOffset } = range;
  if (startContainer === root) return root.childNodes[startOffset + (dir < 0 ? -1 : 0)] ?? null;
  if (startContainer.nodeType !== Node.TEXT_NODE) return null;
  const len = startContainer.textContent?.length ?? 0;
  if (dir < 0 && startOffset === 0) return startContainer.previousSibling;
  if (dir > 0 && startOffset === len) return startContainer.nextSibling;
  return null;
}

/** Deletes a chip next to the caret. Ordinary characters stay with the browser. */
export function deleteAdjacentChip(root: HTMLElement, key: "Backspace" | "Delete"): boolean {
  const target = neighbor(root, key === "Backspace" ? -1 : 1);
  if (!(target instanceof HTMLElement) || !target.hasAttribute(DOC_EXCERPT_ATTR)) return false;
  const before = target.previousSibling;
  const after = target.nextSibling;
  target.remove();
  labelComposerExcerpts(root);
  if (key === "Backspace") {
    if (before) placeCaretAfter(before);
    else placeCaret(root, 0);
  } else if (after instanceof Text) {
    placeCaret(after, 0);
  } else if (after) {
    placeCaret(root, indexOf(root, after));
  } else {
    placeCaret(root, root.childNodes.length);
  }
  return true;
}

function indexOf(root: HTMLElement, node: Node): number {
  return [...root.childNodes].indexOf(node as ChildNode);
}

function flattenPaste(node: Node, out: Node[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text) out.push(document.createTextNode(text));
    return;
  }
  if (!(node instanceof HTMLElement)) {
    for (const child of node.childNodes) flattenPaste(child, out);
    return;
  }
  const payload = node.getAttribute(DOC_EXCERPT_ATTR);
  if (payload != null) {
    const excerpt = decodeDocExcerptPayload(payload);
    const chip = excerpt ? createExcerptChip(excerpt) : null;
    if (chip) out.push(chip);
    return;
  }
  if (node.tagName === "BR") {
    out.push(document.createTextNode("\n"));
    return;
  }
  const block = node.tagName === "DIV" || node.tagName === "P" || node.tagName === "LI";
  if (block && out.length > 0) {
    const last = out[out.length - 1];
    if (!(last instanceof Text) || !last.textContent?.endsWith("\n")) out.push(document.createTextNode("\n"));
  }
  for (const child of node.childNodes) flattenPaste(child, out);
}

/** Paste keeps excerpt chips and plain text. Other formatting is dropped. */
export function nodesFromPaste(html: string, text: string): Node[] {
  if (html.includes(DOC_EXCERPT_ATTR)) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const nodes: Node[] = [];
    flattenPaste(parsed.body, nodes);
    return nodes;
  }
  return nodesFromMarkdown(text);
}

export function insertComposerPaste(root: HTMLElement, html: string, text: string) {
  insertNodes(root, nodesFromPaste(html, text));
}

export function insertComposerText(root: HTMLElement, text: string) {
  if (!text) return;
  insertNodes(root, [document.createTextNode(text)]);
}
