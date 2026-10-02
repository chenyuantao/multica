"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, FileText, Loader2 } from "lucide-react";
import { ApiError, errorCode } from "@multica/core/api";
import { docFileOptions, docsKeys, useSaveDocFile } from "@multica/core/docs";
import type { DocFile } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { ContentEditor, type ContentEditorRef } from "../editor";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { AskAIBadge } from "./ask-ai-badge";
import { useExcerptReveal } from "./doc-excerpt-reveal";
import { joinFrontmatter, noteTitle, parentDir, splitFrontmatter } from "./knowledge-utils";

interface KnowledgeDocumentProps {
  path: string;
  /** `page` drops the title header when a mobile level already shows it. */
  variant?: "pane" | "page";
  /** Shows the Ask AI entry in the pane header. */
  onAskAI?: () => void;
  /** Sends the selected passage to the chat composer. The note itself is not changed. */
  onAskSelection?: (text: string, from?: number) => void;
}

export function KnowledgeDocument({ path, variant = "pane", onAskAI, onAskSelection }: KnowledgeDocumentProps) {
  const { t } = useT("im");
  const { data: file, isPending, isError, error, refetch } = useQuery(docFileOptions(path));
  // Bumped to throw away local edits and remount on the latest server text.
  const [generation, setGeneration] = useState(0);

  const body = isPending ? null : isError || !file ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <FileText className="size-8" />
      <p className="text-body">
        {errorCode(error) === "docs_not_found" ? t(($) => $.knowledge.not_found) : t(($) => $.knowledge.file_load_failed)}
      </p>
      {errorCode(error) !== "docs_not_found" && (
        <Button variant="outline" onClick={() => void refetch()}>
          {t(($) => $.knowledge.retry)}
        </Button>
      )}
    </div>
  ) : (
    <NoteEditor
      key={`${file.path}:${generation}`}
      file={file}
      variant={variant}
      onAskAI={onAskAI}
      onAskSelection={onAskSelection}
      onReload={async () => {
        await refetch();
        setGeneration((g) => g + 1);
      }}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {body}
    </div>
  );
}

type SaveState =
  | { kind: "idle" | "saving" | "saved" }
  | { kind: "error" }
  | { kind: "conflict"; revision: string };

function NoteEditor({
  file,
  variant,
  onAskAI,
  onAskSelection,
  onReload,
}: {
  file: DocFile;
  variant: "pane" | "page";
  onAskAI?: () => void;
  onAskSelection?: (text: string, from?: number) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useT("im");
  const qc = useQueryClient();
  const save = useSaveDocFile();
  const editorRef = useRef<ContentEditorRef>(null);
  const [initial] = useState(() => splitFrontmatter(file.content));
  const frontmatterRef = useRef(initial.frontmatter);
  // The server text this editor last agreed with; every save is based on it.
  const baseRef = useRef({ revision: file.revision, content: file.content });
  const pendingRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  // Set once the user chooses the server version, so the unmount flush of
  // the old editor cannot write the discarded text back.
  const discardedRef = useRef(false);
  const mountedRef = useRef(true);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const reveal = useExcerptReveal();

  useEffect(() => {
    if (!reveal || reveal.path !== file.path) return;
    let stopped = false;
    let tries = 0;
    let timer = 0;
    const tick = () => {
      if (stopped) return;
      const result = editorRef.current?.selectPassage(reveal.text, reveal.from) ?? "pending";
      if (result !== "pending") return;
      if (tries++ >= 20) return;
      timer = window.setTimeout(tick, 50);
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [reveal, file.path]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const report = (next: SaveState) => {
    if (mountedRef.current) setState(next);
  };

  const flush = async () => {
    if (discardedRef.current || savingRef.current || pendingRef.current === null) return;
    const body = pendingRef.current;
    const content = joinFrontmatter(frontmatterRef.current, body);
    pendingRef.current = null;
    const base = baseRef.current;
    if (content === base.content) return;
    savingRef.current = true;
    report({ kind: "saving" });
    try {
      const saved = await save.mutateAsync({
        path: file.path,
        content,
        base_revision: base.revision,
        base_content: base.content,
      });
      baseRef.current = { revision: saved.revision, content: saved.content };
      // A merge with a concurrent change came back different; show it unless
      // the user has typed again, in which case the next save merges again.
      if (saved.content !== content && pendingRef.current === null) {
        const next = splitFrontmatter(saved.content);
        frontmatterRef.current = next.frontmatter;
        editorRef.current?.adoptContent(next.body);
      }
      report({ kind: "saved" });
    } catch (err) {
      pendingRef.current ??= body;
      if (errorCode(err) === "docs_merge_conflict" && err instanceof ApiError) {
        const revision = (err.body as { revision?: unknown } | undefined)?.revision;
        report({ kind: "conflict", revision: typeof revision === "string" ? revision : "" });
      } else {
        report({ kind: "error" });
      }
      return;
    } finally {
      savingRef.current = false;
    }
    void flush();
  };

  const keepMine = () => {
    if (state.kind !== "conflict") return;
    // Rebase onto the server revision so the overwrite is accepted as-is.
    baseRef.current = { revision: state.revision, content: "" };
    pendingRef.current ??= editorRef.current?.getMarkdown() ?? "";
    void flush();
  };

  const reload = async () => {
    discardedRef.current = true;
    pendingRef.current = null;
    await qc.invalidateQueries({ queryKey: docsKeys.file(file.path), refetchType: "none" });
    await onReload();
  };

  const dir = parentDir(file.path);
  const status = <SaveStatus state={state} onRetry={() => void flush()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {variant === "pane" ? (
        <header className="relative flex h-14 shrink-0 items-center gap-3 border-b px-6">
          <div className="absolute inset-0">
            <DragStrip />
          </div>
          <div className="relative min-w-0 flex-1">
            <h1 className="truncate text-body-lg font-semibold">{noteTitle(file.name)}</h1>
            {dir && <p className="truncate text-caption text-muted-foreground">{dir.replaceAll("/", " / ")}</p>}
          </div>
          <div className="relative flex items-center gap-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {status}
            {onAskAI && <AskAIBadge onClick={onAskAI} />}
          </div>
        </header>
      ) : (
        state.kind !== "idle" && <div className="flex shrink-0 justify-end px-4 pt-2">{status}</div>
      )}
      {state.kind === "conflict" && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-warning/10 px-6 py-2.5 text-body">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{t(($) => $.knowledge.conflict)}</span>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            {t(($) => $.knowledge.reload)}
          </Button>
          <Button size="sm" onClick={keepMine}>
            {t(($) => $.knowledge.keep_mine)}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto flex min-h-full w-full max-w-3xl flex-col pt-6 pb-24", variant === "page" ? "px-4" : "px-8")}>
          <ContentEditor
            ref={editorRef}
            defaultValue={initial.body}
            placeholder={t(($) => $.knowledge.placeholder)}
            debounceMs={800}
            disableMentions
            flushPendingOnUnmount
            askSelection={
              onAskSelection
                ? { label: t(($) => $.search.ask_ai), onSelect: onAskSelection }
                : undefined
            }
            onUpdate={(markdown) => {
              pendingRef.current = markdown;
              void flush();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { t } = useT("im");
  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-caption text-destructive hover:bg-destructive/10"
      >
        <AlertTriangle className="size-3.5" />
        {t(($) => $.knowledge.save_failed)} · {t(($) => $.knowledge.retry)}
      </button>
    );
  }
  if (state.kind !== "saving" && state.kind !== "saved") return null;
  return (
    <span aria-live="polite" className={cn("flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground")}>
      {state.kind === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      {state.kind === "saving" ? t(($) => $.knowledge.saving) : t(($) => $.knowledge.saved)}
    </span>
  );
}
