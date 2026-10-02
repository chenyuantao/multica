"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, AtSign, FileText, Image as ImageIcon, Loader2, X } from "lucide-react";
import type { Attachment } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { FileUploadButton } from "@multica/ui/components/common/file-upload-button";
import { ActorAvatar } from "../common/actor-avatar";
import { FileDropOverlay, useEditorUpload, useFileDropZone } from "../editor";
import { attachmentMarkdown } from "../editor/use-coordinated-uploads";
import { useT } from "../i18n";
import { getChatDraft, setChatDraft } from "./chat-draft";
import {
  caretOffset,
  deleteAdjacentChip,
  excerptFromComposerEvent,
  insertComposerExcerpt,
  insertComposerPaste,
  insertComposerText,
  renderComposer,
  serializeComposer,
  setComposerCaret,
} from "./composer-dom";
import type { DocExcerpt } from "./doc-excerpt";
import { useRegisterDocExcerptInsert } from "./doc-excerpt-insert";
import { useRevealDocExcerpt } from "./doc-excerpt-reveal";
import { activeMentionQuery, resolveComposerBody, type ComposerMention } from "./im-utils";
import { VoiceHoldButton } from "./voice-hold";

interface ChatComposerProps {
  /** The chat's issue id; uploads are bound to it. */
  chatId: string;
  chatTitle: string;
  /** Who can be @-mentioned: the chat's own members. */
  candidates: ComposerMention[];
  onSend: (markdown: string, attachmentIds: string[]) => void;
  /** The message the next send quotes, as a one-line summary. */
  quote?: ComposerQuote | null;
  onCancelQuote?: () => void;
}

export interface ComposerQuote {
  id: string;
  name: string;
  text: string;
}

/** `Name: summary` on one line: line breaks read as spaces and overflow ends in an ellipsis. */
export function QuoteText({ quote }: { quote: ComposerQuote }) {
  const { t } = useT("im");
  const label = t(($) => $.thread.quote_line, { name: quote.name, text: quote.text }).replace(/\s+/g, " ").trim();
  return (
    <span className="block min-w-0 truncate" title={label}>
      {label}
    </span>
  );
}

interface ComposerFile {
  key: string;
  name: string;
  isImage: boolean;
  attachment?: Attachment;
}

const MAX_HEIGHT_PX = 180;

function useCoarsePointer() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

export function ChatComposer({ chatId, chatTitle, candidates, onSend, quote, onCancelQuote }: ChatComposerProps) {
  const { t } = useT("im");
  const { t: tEditor } = useT("editor");
  const isMobile = useIsMobile();
  const coarsePointer = useCoarsePointer();
  const ref = useRef<HTMLDivElement>(null);
  const { uploadWithToast } = useEditorUpload();
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const uploading = files.some((f) => !f.attachment);
  const [text, setTextState] = useState("");
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<ComposerMention[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const setText = useCallback((next: string) => {
    setTextState(next);
    setChatDraft(chatId, next);
  }, [chatId]);
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setText(serializeComposer(el));
    setCaret(caretOffset(el));
  }, [setText]);
  useLayoutEffect(() => {
    const draft = getChatDraft(chatId);
    const el = ref.current;
    if (el) renderComposer(el, draft);
    setTextState(draft);
    setCaret(draft.length);
  }, [chatId]);

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

  const registerExcerpt = useRegisterDocExcerptInsert();
  const revealExcerpt = useRevealDocExcerpt();
  const chipTap = useRef(false);
  const insertExcerpt = useCallback((excerpt: DocExcerpt) => {
    const el = ref.current;
    if (!el || !insertComposerExcerpt(el, excerpt)) return;
    sync();
  }, [sync]);
  useEffect(() => registerExcerpt(chatId, insertExcerpt), [registerExcerpt, chatId, insertExcerpt]);

  const quoteId = quote?.id;
  useEffect(() => {
    if (quoteId) ref.current?.focus();
  }, [quoteId]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const syncCaret = () => {
    const el = ref.current;
    if (el) setCaret(caretOffset(el));
  };

  const insertMention = (m: ComposerMention) => {
    if (!mention) return;
    const token = `@${m.name} `;
    const next = text.slice(0, mention.start) + token + text.slice(caret);
    const nextCaret = mention.start + token.length;
    const el = ref.current;
    if (el) {
      renderComposer(el, next);
      setComposerCaret(el, nextCaret);
      el.focus();
    }
    setText(next);
    setPicked((prev) => [...prev, m]);
    setCaret(nextCaret);
  };

  const startMention = () => {
    const el = ref.current;
    const current = el ? serializeComposer(el) : text;
    const at = el ? caretOffset(el) : current.length;
    const needsSpace = at > 0 && !/\s/.test(current[at - 1] ?? "");
    const insert = needsSpace ? " @" : "@";
    const next = current.slice(0, at) + insert + current.slice(at);
    const nextCaret = at + insert.length;
    if (el) {
      renderComposer(el, next);
      setComposerCaret(el, nextCaret);
      el.focus();
    }
    setText(next);
    setDismissedAt(null);
    setCaret(nextCaret);
  };

  const addFiles = (list: File[]) => {
    for (const file of list) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setFiles((prev) => [...prev, { key, name: file.name, isImage: file.type.startsWith("image/") }]);
      void uploadWithToast(file, { issueId: chatId }).then((attachment) => {
        setFiles((prev) =>
          attachment
            ? prev.map((f) => (f.key === key ? { ...f, attachment } : f))
            : prev.filter((f) => f.key !== key),
        );
      });
    }
  };
  const { isDragOver, dropZoneProps } = useFileDropZone({ onDrop: addFiles });

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length > 0) {
      e.preventDefault();
      addFiles(pasted);
      return;
    }
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    insertComposerPaste(el, e.clipboardData.getData("text/html"), e.clipboardData.getData("text/plain"));
    sync();
  };

  const onClipboard = (e: React.ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed || !el.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const holder = document.createElement("div");
    holder.appendChild(range.cloneContents());
    e.clipboardData.setData("text/plain", serializeComposer(holder));
    e.clipboardData.setData("text/html", holder.innerHTML);
    e.preventDefault();
    if (!cut) return;
    range.deleteContents();
    sync();
  };

  const ready = files.flatMap((f) => (f.attachment ? [f.attachment] : []));
  const canSend = !uploading && (!!text.trim() || ready.length > 0);
  const voiceReady = (isMobile || coarsePointer) && !text.trim() && files.length === 0 && !uploading;
  const fillSpoken = useCallback((spoken: string) => {
    const el = ref.current;
    if (!el) return;
    renderComposer(el, spoken);
    setText(spoken);
    setCaret(spoken.length);
    el.focus();
  }, [setText]);

  const send = () => {
    if (!canSend) return;
    const body = text.trim();
    let markdown = "";
    if (body) {
      const resolved = resolveComposerBody(body, picked.filter((m) => body.includes(`@${m.name}`)), candidates);
      if (!resolved.ok) {
        setNameError(resolved.name);
        return;
      }
      markdown = resolved.markdown;
    }
    setNameError(null);
    onSend(
      [markdown, ...ready.map(attachmentMarkdown)].filter(Boolean).join("\n\n"),
      ready.map((a) => a.id),
    );
    setText("");
    setPicked([]);
    setCaret(0);
    setFiles([]);
    if (ref.current) renderComposer(ref.current, "");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
    if (e.key === "Escape" && quote) {
      e.preventDefault();
      onCancelQuote?.();
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && ref.current && deleteAdjacentChip(ref.current, e.key)) {
      e.preventDefault();
      sync();
      return;
    }
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if (ref.current) {
        insertComposerText(ref.current, "\n");
        sync();
      }
      return;
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
                <ActorAvatar actorType={s.type} actorId={s.id} size="sm" profileLink={false} showStatusDot />
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
      <div
        {...dropZoneProps}
        className={cn(
          "relative border bg-background px-2 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring/40",
          files.length > 0 || quote ? "rounded-2xl" : "rounded-3xl",
        )}
      >
        {quote && (
          <div className="mx-1 mt-1 mb-1.5 flex min-w-0 items-center gap-1 rounded-lg bg-muted py-0.5 pr-0.5 pl-2 text-caption text-muted-foreground">
            <span className="min-w-0 flex-1">
              <QuoteText quote={quote} />
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 rounded-md"
              onClick={onCancelQuote}
              aria-label={t(($) => $.composer.cancel_quote)}
            >
              <X />
            </Button>
          </div>
        )}
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-1 pt-1 pb-1.5">
            {files.map((f) => {
              const Icon = f.isImage ? ImageIcon : FileText;
              return (
                <li
                  key={f.key}
                  className="flex h-7 max-w-60 min-w-0 items-center gap-1.5 rounded-lg bg-muted pr-0.5 pl-2 text-caption"
                  aria-busy={!f.attachment || undefined}
                >
                  {f.attachment ? (
                    <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Loader2
                      aria-label={tEditor(($) => $.upload.uploading_label, { filename: f.name })}
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                    />
                  )}
                  <span className="truncate" title={f.name}>
                    {f.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 rounded-md"
                    onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}
                    aria-label={`${tEditor(($) => $.attachment.remove)}: ${f.name}`}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <FileUploadButton multiple className="shrink-0 rounded-full" onSelect={(file) => addFiles([file])} />
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
          <div className="relative min-h-8 flex-1">
            {text.length === 0 && (
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1.5 truncate text-body text-muted-foreground">
                {t(($) => $.composer.placeholder, { title: chatTitle })}
              </span>
            )}
            <div
              ref={ref}
              role="textbox"
              aria-multiline="true"
              aria-label={t(($) => $.composer.placeholder, { title: chatTitle })}
              contentEditable
              suppressContentEditableWarning
              onInput={sync}
              onKeyUp={syncCaret}
              onMouseDown={(e) => {
                if (ref.current && excerptFromComposerEvent(ref.current, e.target)) e.preventDefault();
              }}
              onPointerUp={(e) => {
                const excerpt = ref.current ? excerptFromComposerEvent(ref.current, e.target) : null;
                if (!excerpt || e.button > 0) return;
                e.preventDefault();
                chipTap.current = true;
                revealExcerpt(excerpt);
              }}
              onClick={(e) => {
                const excerpt = ref.current ? excerptFromComposerEvent(ref.current, e.target) : null;
                if (excerpt) {
                  if (!chipTap.current) revealExcerpt(excerpt);
                  chipTap.current = false;
                  return;
                }
                syncCaret();
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCopy={(e) => onClipboard(e, false)}
              onCut={(e) => onClipboard(e, true)}
              className="max-h-[180px] min-h-8 w-full overflow-y-auto py-1.5 text-body break-words whitespace-pre-wrap outline-none"
            />
          </div>
          {voiceReady ? (
            <VoiceHoldButton
              onSend={(spoken) => onSend(spoken, [])}
              onEdit={fillSpoken}
            />
          ) : (
            <Button
              size="icon-sm"
              className="shrink-0 rounded-full"
              onClick={send}
              disabled={!canSend}
              aria-label={uploading ? tEditor(($) => $.upload.in_progress) : t(($) => $.composer.send)}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
        {isDragOver && <FileDropOverlay />}
      </div>
    </div>
  );
}
