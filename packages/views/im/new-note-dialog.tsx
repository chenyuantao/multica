"use client";

import { useState } from "react";
import { errorCode } from "@multica/core/api";
import { useCreateDocFile } from "@multica/core/docs";
import type { DocFile } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../i18n";
import { noteFileName, noteTitle } from "./knowledge-utils";

interface NewNoteDialogProps {
  /** Target directory, or null while closed. "" is the vault root. */
  dir: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (file: DocFile) => void;
  /** `page` fills a phone level whose header carries the title. */
  presentation?: "dialog" | "page";
}

export function NewNoteDialog({ dir, onOpenChange, onCreated, presentation = "dialog" }: NewNoteDialogProps) {
  const { t } = useT("im");
  const createNote = useCreateDocFile();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName("");
    setError(null);
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dir === null || createNote.isPending) return;
    const file = noteFileName(name);
    if (!file) {
      setError(t(($) => $.knowledge.dialog.invalid));
      return;
    }
    try {
      const created = await createNote.mutateAsync({
        path: dir ? `${dir}/${file}` : file,
        content: `# ${noteTitle(file)}\n`,
      });
      close();
      onCreated(created);
    } catch (err) {
      setError(
        errorCode(err) === "docs_exists" ? t(($) => $.knowledge.dialog.exists) : t(($) => $.knowledge.dialog.failed),
      );
    }
  };

  const location = t(($) => $.knowledge.dialog.location, {
    dir: dir ? dir.replaceAll("/", " / ") : t(($) => $.knowledge.dialog.root),
  });
  const field = (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-new-note-name">{t(($) => $.knowledge.dialog.name_label)}</Label>
            <Input
              id="knowledge-new-note-name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={t(($) => $.knowledge.dialog.name_placeholder)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "knowledge-new-note-error" : undefined}
            />
            {error && (
              <p id="knowledge-new-note-error" className="text-caption text-destructive">
                {error}
              </p>
            )}
          </div>
  );
  const submitButton = (
    <Button type="submit" disabled={!name.trim() || createNote.isPending} aria-busy={createNote.isPending}>
      {t(($) => $.knowledge.dialog.create)}
    </Button>
  );

  if (presentation === "page") {
    return (
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <p className="text-caption break-all text-muted-foreground">{location}</p>
          {field}
        </div>
        <div className="flex shrink-0 justify-end border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {submitButton}
        </div>
      </form>
    );
  }

  return (
    <Dialog open={dir !== null} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(($) => $.knowledge.dialog.title)}</DialogTitle>
            <DialogDescription className="break-all">{location}</DialogDescription>
          </DialogHeader>
          {field}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t(($) => $.knowledge.dialog.cancel)}
            </DialogClose>
            {submitButton}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
