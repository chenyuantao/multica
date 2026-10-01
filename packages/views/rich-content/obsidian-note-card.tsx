"use client";

import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, ExternalLink, FileText, Loader2 } from "lucide-react";
import { docsKeys } from "@multica/core/docs";
import { paths, useWorkspaceSlug } from "@multica/core/paths";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../i18n";
import { AppLink, useOptionalNavigation } from "../navigation";
import type { ObsidianNote } from "./obsidian-note";

// The note editor pulls in Tiptap, which chat would otherwise not load.
const KnowledgeDocument = lazy(() =>
  import("../im/knowledge-document").then((m) => ({ default: m.KnowledgeDocument })),
);

/** Link-preview card for a note an agent wrote; opens the note in a dialog. */
export function ObsidianNoteCard({ note }: { note: ObsidianNote }) {
  const { t } = useT("im");
  const qc = useQueryClient();
  const slug = useWorkspaceSlug();
  const canNavigate = useOptionalNavigation() != null && slug != null;
  const [open, setOpen] = useState(false);

  const show = () => {
    // Notes are cached without expiry; the agent may have changed this one since.
    qc.removeQueries({ queryKey: docsKeys.file(note.path), exact: true });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          show();
        }}
        className="my-3 flex w-full max-w-sm flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="line-clamp-2 text-body font-medium break-words text-foreground">{note.name}</span>
        <span className="flex items-start gap-3">
          <span className="line-clamp-3 min-w-0 flex-1 text-caption break-words text-muted-foreground">
            {note.summary}
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileText className="size-5" />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <BookOpen className="size-3.5 shrink-0" />
          <span className="truncate">{note.path}</span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(85dvh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
            <DialogTitle className="truncate">{note.name}</DialogTitle>
            <div className="flex min-w-0 items-center gap-3">
              <DialogDescription className="min-w-0 flex-1 truncate">{note.path}</DialogDescription>
              {canNavigate && (
                <AppLink
                  href={paths.workspace(slug).knowledgeFile(note.path)}
                  onClick={() => setOpen(false)}
                  className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                  {t(($) => $.knowledge.card.open_in_knowledge)}
                </AppLink>
              )}
            </div>
          </DialogHeader>
          {open && (
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              }
            >
              <KnowledgeDocument path={note.path} variant="page" />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
