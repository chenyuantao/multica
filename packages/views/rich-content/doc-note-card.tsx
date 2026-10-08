"use client";

import type { MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileText } from "lucide-react";
import { docsKeys } from "@multica/core/docs";
import { paths, useWorkspaceSlug } from "@multica/core/paths";
import { docPathToOpen, useDocOpenPath } from "../im/doc-open-path";
import { useOpenKnowledgeNote } from "../im/knowledge-note-tabs";
import { AppLink } from "../navigation";
import type { DocNote } from "./doc-note";

const FRAME =
  "my-3 flex w-full max-w-sm flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Link-preview card for a doc an agent wrote. Opens in the chat sidebar when one is available. */
export function DocNoteCard({ note }: { note: DocNote }) {
  const qc = useQueryClient();
  const slug = useWorkspaceSlug();
  const openNote = useOpenKnowledgeNote();
  const openPath = useDocOpenPath(note.path);
  const href = slug ? paths.workspace(slug).knowledgeFile(openPath) : null;

  const activate = (e: MouseEvent) => {
    e.stopPropagation();
    if (!openNote || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void (async () => {
      const path = await docPathToOpen(qc, note.path);
      qc.removeQueries({ queryKey: docsKeys.file(path), exact: true });
      if (path !== note.path) qc.removeQueries({ queryKey: docsKeys.file(note.path), exact: true });
      openNote({ path, name: note.name });
    })();
  };

  const body = (
    <>
      <span className="line-clamp-2 text-body font-medium break-words text-foreground">{note.name}</span>
      <span className="flex items-start gap-3">
        <span className="line-clamp-3 min-w-0 flex-1 text-caption break-words text-muted-foreground">{note.summary}</span>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FileText className="size-5" />
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        <BookOpen className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{openPath}</span>
      </span>
    </>
  );

  if (!href) {
    return (
      <button type="button" onClick={activate} className={FRAME}>
        {body}
      </button>
    );
  }
  return (
    <AppLink href={href} onClick={activate} className={FRAME}>
      {body}
    </AppLink>
  );
}
