"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { ActorAvatar } from "../common/actor-avatar";
import { useT } from "../i18n";
import { activeMentionQuery, resolveComposerMentions, type ComposerMention } from "./im-utils";

interface ChatComposerProps {
  chatTitle: string;
  /** Who can be @-mentioned: the chat's own members. */
  candidates: ComposerMention[];
  onSend: (markdown: string) => void;
}

const MAX_HEIGHT_PX = 180;

export function ChatComposer({ chatTitle, candidates, onSend }: ChatComposerProps) {
  const { t } = useT("im");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<ComposerMention[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const mention = activeMentionQuery(text, caret);
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
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? 0);

  const insertMention = (m: ComposerMention) => {
    if (!mention) return;
    const token = `@${m.name} `;
    const next = text.slice(0, mention.start) + token + text.slice(caret);
    const nextCaret = mention.start + token.length;
    setText(next);
    setPicked((prev) => [...prev, m]);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const startMention = () => {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    const needsSpace = at > 0 && !/\s/.test(text[at - 1] ?? "");
    const insert = needsSpace ? " @" : "@";
    const next = text.slice(0, at) + insert + text.slice(at);
    setText(next);
    setDismissedAt(null);
    const nextCaret = at + insert.length;
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const resolved = resolveComposerMentions(body, picked.filter((m) => body.includes(`@${m.name}`)), candidates);
    if (!resolved.ok) {
      setNameError(resolved.name);
      return;
    }
    setNameError(null);
    onSend(resolved.markdown);
    setText("");
    setPicked([]);
    setCaret(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const hasAgents = candidates.some((c) => c.type === "agent");

  return (
    <div className="relative px-4 pt-2 pb-4">
      {menuOpen && (
        <ul
          role="listbox"
          aria-label={t(($) => $.composer.mention)}
          className="absolute right-4 bottom-full left-4 z-10 mb-1 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
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
                <ActorAvatar actorType={s.type} actorId={s.id} size="sm" shape="rounded" profileLink={false} showStatusDot />
                <span className="truncate">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {nameError && (
        <p className="mb-1 px-2 text-caption text-destructive" role="alert">
          {t(($) => $.composer.ambiguous, { name: nameError })}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-3xl border bg-background px-2 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-full"
          onClick={startMention}
          disabled={!hasAgents}
          aria-label={hasAgents ? t(($) => $.composer.mention) : t(($) => $.composer.no_agents)}
        >
          <AtSign />
        </Button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={syncCaret}
          onKeyDown={onKeyDown}
          placeholder={t(($) => $.composer.placeholder, { title: chatTitle })}
          aria-label={t(($) => $.composer.placeholder, { title: chatTitle })}
          className="min-h-8 flex-1 resize-none bg-transparent py-1.5 text-body outline-none placeholder:text-muted-foreground"
        />
        <Button
          size="icon-sm"
          className="shrink-0 rounded-full"
          onClick={send}
          disabled={!text.trim()}
          aria-label={t(($) => $.composer.send)}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}
