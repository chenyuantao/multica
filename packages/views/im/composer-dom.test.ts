// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  caretOffset,
  deleteAdjacentChip,
  insertComposerExcerpt,
  insertComposerPaste,
  renderComposer,
  serializeComposer,
} from "./composer-dom";
import { encodeDocExcerpt, encodeDocExcerptPayload } from "./doc-excerpt";
import { DOC_EXCERPT_ATTR } from "./doc-excerpt-chip";

const weekly = { name: "本周周报", path: "notes/weekly.md", text: "周五发布" };
const plan = { name: "计划", path: "notes/plan.md", text: "下周一评审" };

function editor(): HTMLDivElement {
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.appendChild(root);
  return root;
}

describe("composer excerpts", () => {
  it("inserts passages as chips that serialize back and paste again", () => {
    const root = editor();
    renderComposer(root, "请改 ");
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(insertComposerExcerpt(root, weekly)).toBe(true);
    expect(insertComposerExcerpt(root, plan)).toBe(true);
    const markdown = serializeComposer(root);
    expect(markdown).toBe(`请改 ${encodeDocExcerpt(weekly)} ${encodeDocExcerpt(plan)} `);
    expect(root.querySelectorAll(`[${DOC_EXCERPT_ATTR}]`)).toHaveLength(2);

    const next = editor();
    insertComposerPaste(next, root.innerHTML, "ignored");
    expect(serializeComposer(next)).toBe(markdown);

    const payload = encodeDocExcerptPayload(weekly)!;
    const plain = editor();
    insertComposerPaste(plain, "", `开头 ${encodeDocExcerpt(weekly)} 结尾`);
    expect(plain.querySelector(`[${DOC_EXCERPT_ATTR}]`)?.getAttribute(DOC_EXCERPT_ATTR)).toBe(payload);
    expect(serializeComposer(plain)).toContain(encodeDocExcerpt(weekly));
  });

  it("deletes a whole chip with backspace and keeps the surrounding words", () => {
    const root = editor();
    renderComposer(root, `请改 ${encodeDocExcerpt(weekly)} 这里`);
    const chip = root.querySelector(`[${DOC_EXCERPT_ATTR}]`)!;
    const after = chip.nextSibling;
    expect(after).toBeTruthy();
    const range = document.createRange();
    range.setStart(after!, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(caretOffset(root)).toBe(`请改 ${encodeDocExcerpt(weekly)}`.length);

    expect(deleteAdjacentChip(root, "Backspace")).toBe(true);
    expect(serializeComposer(root)).toBe("请改  这里");
    expect(root.querySelector(`[${DOC_EXCERPT_ATTR}]`)).toBeNull();
  });

  it("shows the document name, numbers repeats, and keeps the chip within 100px", () => {
    const root = editor();
    renderComposer(root, "请改 ");
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    insertComposerExcerpt(root, weekly);
    insertComposerExcerpt(root, weekly);
    insertComposerExcerpt(root, plan);
    const chips = [...root.querySelectorAll(`[${DOC_EXCERPT_ATTR}]`)];
    expect(chips.map((chip) => chip.textContent)).toEqual(["本周周报1", "本周周报2", "计划"]);
    expect(chips[0]?.textContent).not.toContain("周五发布");
    expect(chips[0]?.className).toContain("max-w-[100px]");
    expect(chips[0]?.className).toContain("overflow-hidden");

    const second = chips[1]!;
    const after = second.nextSibling;
    const caret = document.createRange();
    caret.setStart(after!, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    expect(deleteAdjacentChip(root, "Backspace")).toBe(true);
    expect([...root.querySelectorAll(`[${DOC_EXCERPT_ATTR}]`)].map((chip) => chip.textContent)).toEqual([
      "本周周报",
      "计划",
    ]);
  });
});
