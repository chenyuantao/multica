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
}

export function NewNoteDialog({ dir, onOpenChange, onCreated }: NewNoteDialogProps) {
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

  return (
    <Dialog open={dir !== null} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(($) => $.knowledge.dialog.title)}</DialogTitle>
            <DialogDescription className="break-all">
              {t(($) => $.knowledge.dialog.location, {
                dir: dir ? dir.replaceAll("/", " / ") : t(($) => $.knowledge.dialog.root),
              })}
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t(($) => $.knowledge.dialog.cancel)}
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || createNote.isPending} aria-busy={createNote.isPending}>
              {t(($) => $.knowledge.dialog.create)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
