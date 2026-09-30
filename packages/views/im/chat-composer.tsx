"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign, FileText, Image as ImageIcon, Loader2, X } from "lucide-react";
import type { Attachment } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { FileUploadButton } from "@multica/ui/components/common/file-upload-button";
import { ActorAvatar } from "../common/actor-avatar";
import { FileDropOverlay, useEditorUpload, useFileDropZone } from "../editor";
import { attachmentMarkdown } from "../editor/use-coordinated-uploads";
import { useT } from "../i18n";
import { activeMentionQuery, resolveComposerMentions, type ComposerMention } from "./im-utils";

interface ChatComposerProps {
  /** The chat's issue id; uploads are bound to it. */
  chatId: string;
  chatTitle: string;
  /** Who can be @-mentioned: the chat's own members. */
  candidates: ComposerMention[];
  onSend: (markdown: string, attachmentIds: string[]) => void;
}

interface ComposerFile {
  key: string;
  name: string;
  isImage: boolean;
  attachment?: Attachment;
}

const MAX_HEIGHT_PX = 180;

export function ChatComposer({ chatId, chatTitle, candidates, onSend }: ChatComposerProps) {
  const { t } = useT("im");
  const { t: tEditor } = useT("editor");
  const ref = useRef<HTMLTextAreaElement>(null);
  const { uploadWithToast } = useEditorUpload();
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const uploading = files.some((f) => !f.attachment);
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

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  };

  const ready = files.flatMap((f) => (f.attachment ? [f.attachment] : []));
  const canSend = !uploading && (!!text.trim() || ready.length > 0);

  const send = () => {
    if (!canSend) return;
    const body = text.trim();
    let markdown = "";
    if (body) {
      const resolved = resolveComposerMentions(body, picked.filter((m) => body.includes(`@${m.name}`)), candidates);
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
          files.length > 0 ? "rounded-2xl" : "rounded-3xl",
        )}
      >
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
            onPaste={onPaste}
            placeholder={t(($) => $.composer.placeholder, { title: chatTitle })}
            aria-label={t(($) => $.composer.placeholder, { title: chatTitle })}
            className="min-h-8 flex-1 resize-none bg-transparent py-1.5 text-body outline-none placeholder:text-muted-foreground"
          />
          <Button
            size="icon-sm"
            className="shrink-0 rounded-full"
            onClick={send}
            disabled={!canSend}
            aria-label={uploading ? tEditor(($) => $.upload.in_progress) : t(($) => $.composer.send)}
          >
            <ArrowUp />
          </Button>
        </div>
        {isDragOver && <FileDropOverlay />}
      </div>
    </div>
  );
}
