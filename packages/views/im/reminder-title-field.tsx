"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { isImeComposing } from "@multica/core/utils";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { useT } from "../i18n";
import { activeMentionQuery, type ComposerMention } from "./im-utils";

interface ReminderTitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  picked: ComposerMention[];
  onPickedChange: (picked: ComposerMention[]) => void;
  candidates: ComposerMention[];
  /** The shared name that blocked the last save, if several members use it. */
  errorName: string | null;
  onCommit: () => void;
  onCancel: () => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  inputClassName?: string;
}

/**
 * The single-line reminder title. Typing `@` offers agents; choosing one
 * records a mention the title save turns into an assignment.
 */
export function ReminderTitleField({
  value,
  onChange,
  picked,
  onPickedChange,
  candidates,
  errorName,
  onCommit,
  onCancel,
  disabled,
  placeholder,
  ariaLabel,
  inputClassName,
}: ReminderTitleFieldProps) {
  const { t } = useT("im");
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  const mention = activeMentionQuery(value, caret);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return candidates
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.type === "agent") - Number(a.type === "agent"))
      .slice(0, 8);
  }, [candidates, mention]);
  const menuOpen = !!mention && dismissedAt !== mention.start && suggestions.length > 0;

  useEffect(() => setHighlight(0), [mention?.query]);
  useEffect(() => {
    if (errorName) ref.current?.focus();
  }, [errorName]);

  useLayoutEffect(() => {
    const el = ref.current;
    const at = pendingCaret.current;
    if (!el || at == null) return;
    pendingCaret.current = null;
    el.setSelectionRange(at, at);
    setCaret(at);
    el.focus();
  }, [value]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(280, Math.max(rect.width, 200));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const above = window.innerHeight - rect.bottom < 200 && rect.top > 200;
      setBox({ top: above ? rect.top - 4 : rect.bottom + 4, left, width, above });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menuOpen, mention?.query, value]);

  const readCaret = (el: HTMLInputElement) => setCaret(el.selectionStart ?? el.value.length);

  const insertMention = (m: ComposerMention) => {
    if (!mention) return;
    const token = `@${m.name} `;
    const next = value.slice(0, mention.start) + token + value.slice(caret);
    pendingCaret.current = mention.start + token.length;
    onChange(next);
    onPickedChange([...picked, m]);
    setDismissedAt(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + delta + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const choice = suggestions[highlight];
        if (choice) insertMention(choice);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(mention?.start ?? null);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <input
        ref={ref}
        autoFocus
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          readCaret(e.target);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => readCaret(e.currentTarget)}
        onClick={(e) => readCaret(e.currentTarget)}
        onBlur={onCommit}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? "reminder-mention-list" : undefined}
        className={cn("w-full bg-transparent text-body outline-none placeholder:text-muted-foreground", inputClassName)}
      />
      {errorName && (
        <p className="text-caption text-destructive" role="alert">
          {t(($) => $.composer.ambiguous, { name: errorName })}
        </p>
      )}
      {menuOpen &&
        box &&
        createPortal(
          <ul
            id="reminder-mention-list"
            role="listbox"
            aria-label={t(($) => $.composer.mention)}
            style={{
              top: box.top,
              left: box.left,
              width: box.width,
              transform: box.above ? "translateY(-100%)" : undefined,
            }}
            className="fixed z-50 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.type}:${s.id}`} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => insertMention(s)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body",
                    i === highlight && "bg-accent",
                  )}
                >
                  <ActorAvatar actorType={s.type} actorId={s.id} size="sm" profileLink={false} showStatusDot />
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
