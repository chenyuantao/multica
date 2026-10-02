"use client";

import {
  decodeDocExcerptPayload,
  encodeDocExcerptPayload,
  type DocExcerpt,
  type DocExcerptChipLabel,
} from "./doc-excerpt";

export const DOC_EXCERPT_ATTR = "data-doc-excerpt";

export const DOC_EXCERPT_CHIP_CLASS =
  "mx-0.5 inline-flex max-w-[100px] min-w-0 items-baseline overflow-hidden rounded-r-md border-l-2 border-primary/70 bg-muted px-1.5 align-baseline text-caption text-foreground";

const NAME_CLASS = "min-w-0 truncate";
const INDEX_CLASS = "shrink-0";

/** The passage as an atomic chip. Copying it keeps the payload, so a paste restores the block. */
export function DocExcerptChip({
  excerpt,
  label,
}: {
  excerpt: DocExcerpt;
  label?: DocExcerptChipLabel;
}) {
  const shown = label ?? { name: excerpt.name, index: null };
  const payload = encodeDocExcerptPayload(excerpt);
  return (
    <span
      {...{ [DOC_EXCERPT_ATTR]: payload ?? undefined }}
      title={`${excerpt.name} · ${excerpt.path}`}
      aria-label={`${excerpt.name}: ${excerpt.text}`}
      className={DOC_EXCERPT_CHIP_CLASS}
    >
      <span data-excerpt-name="" className={NAME_CLASS}>
        {shown.name}
      </span>
      {shown.index != null && (
        <span data-excerpt-index="" className={INDEX_CLASS}>
          {shown.index}
        </span>
      )}
    </span>
  );
}

export function createExcerptChip(excerpt: DocExcerpt): HTMLSpanElement | null {
  const payload = encodeDocExcerptPayload(excerpt);
  if (!payload) return null;
  const normalized = decodeDocExcerptPayload(payload);
  if (!normalized) return null;
  const span = document.createElement("span");
  span.setAttribute(DOC_EXCERPT_ATTR, payload);
  span.contentEditable = "false";
  span.spellcheck = false;
  span.title = `${normalized.name} · ${normalized.path}`;
  span.setAttribute("aria-label", `${normalized.name}: ${normalized.text}`);
  span.className = `${DOC_EXCERPT_CHIP_CLASS} cursor-pointer`;
  const name = document.createElement("span");
  name.setAttribute("data-excerpt-name", "");
  name.className = NAME_CLASS;
  name.textContent = normalized.name;
  const index = document.createElement("span");
  index.setAttribute("data-excerpt-index", "");
  index.className = INDEX_CLASS;
  index.hidden = true;
  span.append(name, index);
  return span;
}

/** Updates the visible name. The payload, and the passage inside it, stay put. */
export function setExcerptChipLabel(chip: HTMLElement, label: DocExcerptChipLabel) {
  const name = chip.querySelector("[data-excerpt-name]");
  const index = chip.querySelector("[data-excerpt-index]");
  if (name) name.textContent = label.name;
  if (index instanceof HTMLElement) {
    index.textContent = label.index == null ? "" : String(label.index);
    index.hidden = label.index == null;
  }
}
