"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";

/**
 * `data-element-picker-ignore` marks layers that are never picked: the
 * picker's own and the dialog that is still animating out.
 */
function pickable(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-element-picker-ignore],[data-slot="dialog-overlay"]')) return null;
  return target;
}

/**
 * Outlines the element under the pointer and hands the clicked one back.
 * While it is mounted, presses on the page are swallowed so picking never
 * triggers the page's own buttons or links. Escape cancels.
 */
export function ElementPicker({ onPick, onCancel }: { onPick: (el: Element) => void; onCancel: () => void }) {
  const { t } = useT("im");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const handlers = useRef({ onPick, onCancel });
  handlers.current = { onPick, onCancel };

  useEffect(() => {
    let target: Element | null = null;
    const track = (el: Element | null) => {
      target = el;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const onMove = (e: PointerEvent) => track(pickable(e.target));
    const swallow = (e: Event) => {
      if (!pickable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      const el = pickable(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      handlers.current.onPick(el);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      handlers.current.onCancel();
    };
    const onViewport = () => track(target);
    const swallowed = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu"];
    document.addEventListener("pointermove", onMove, true);
    for (const type of swallowed) document.addEventListener(type, swallow, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onViewport, true);
    window.addEventListener("resize", onViewport);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      for (const type of swallowed) document.removeEventListener(type, swallow, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onViewport, true);
      window.removeEventListener("resize", onViewport);
    };
  }, []);

  return createPortal(
    <div data-element-picker-ignore="" className="pointer-events-none fixed inset-0 z-[1000]">
      <style>{"* { cursor: crosshair !important; }"}</style>
      {rect && (
        <div
          data-testid="element-picker-outline"
          className="fixed rounded-sm bg-brand/10 ring-2 ring-brand transition-[top,left,width,height] duration-75"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <p
        role="status"
        className="fixed top-14 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1.5 text-caption text-background shadow-md"
      >
        {t(($) => $.search.pick_hint)}
      </p>
    </div>,
    document.body,
  );
}
