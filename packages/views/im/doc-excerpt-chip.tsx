"use client";

import {
  decodeDocExcerptPayload,
  docExcerptLabel,
  encodeDocExcerptPayload,
  type DocExcerpt,
} from "./doc-excerpt";

export const DOC_EXCERPT_ATTR = "data-doc-excerpt";

export const DOC_EXCERPT_CHIP_CLASS =
  "mx-0.5 inline-flex max-w-full min-w-0 items-baseline rounded-r-md border-l-2 border-primary/70 bg-muted px-1.5 align-baseline text-caption text-foreground";

/** The passage as an atomic chip. Copying it keeps the payload, so a paste restores the block. */
export function DocExcerptChip({ excerpt }: { excerpt: DocExcerpt }) {
  const payload = encodeDocExcerptPayload(excerpt);
  return (
    <span
      {...{ [DOC_EXCERPT_ATTR]: payload ?? undefined }}
      title={`${excerpt.name} · ${excerpt.path}`}
      aria-label={`${excerpt.name}: ${excerpt.text}`}
      className={DOC_EXCERPT_CHIP_CLASS}
    >
      <span className="truncate">{docExcerptLabel(excerpt)}</span>
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
  span.className = DOC_EXCERPT_CHIP_CLASS;
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = docExcerptLabel(normalized);
  span.appendChild(label);
  return span;
}
