"use client";

import { useEffect, useState } from "react";
import { errorCode } from "@multica/core/api";
import { useCreateDocFolder, useDeleteDoc, useRenameDoc } from "@multica/core/docs";
import type { DocMoveResult, DocNode } from "@multica/core/types";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { useT } from "../i18n";
import { folderName, joinDocPath, noteFileName, noteTitle, parentDir } from "./knowledge-utils";

function locationText(dir: string, root: string, location: (dir: string) => string) {
  return location(dir ? dir.replaceAll("/", " / ") : root);
}

export function NewFolderDialog({
  dir,
  onOpenChange,
  onCreated,
}: {
  /** Parent directory, or null while closed. */
  dir: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (path: string) => void;
}) {
  const { t } = useT("im");
  const createFolder = useCreateDocFolder();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState(dir ?? "");
  if (dir !== null && dir !== place) setPlace(dir);

  const close = () => {
    if (createFolder.isPending) return;
    setName("");
    setError(null);
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dir === null || createFolder.isPending) return;
    const folder = folderName(name);
    if (!folder) {
      setError(t(($) => $.knowledge.dialog.invalid));
      return;
    }
    try {
      const created = await createFolder.mutateAsync({ path: joinDocPath(dir, folder) });
      setName("");
      setError(null);
      onOpenChange(false);
      onCreated(created.path);
    } catch (err) {
      setError(
        errorCode(err) === "docs_exists"
          ? t(($) => $.knowledge.folder_dialog.exists)
          : t(($) => $.knowledge.folder_dialog.failed),
      );
    }
  };

  return (
    <Dialog open={dir !== null} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(($) => $.knowledge.folder_dialog.title)}</DialogTitle>
            <DialogDescription className="break-all">
              {locationText(place, t(($) => $.knowledge.dialog.root), (shown) =>
                t(($) => $.knowledge.dialog.location, { dir: shown }),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-new-folder-name">{t(($) => $.knowledge.dialog.name_label)}</Label>
            <Input
              id="knowledge-new-folder-name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={t(($) => $.knowledge.folder_dialog.placeholder)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "knowledge-new-folder-error" : undefined}
            />
            {error && (
              <p id="knowledge-new-folder-error" className="text-caption text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={createFolder.isPending} />}>
              {t(($) => $.knowledge.dialog.cancel)}
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || createFolder.isPending} aria-busy={createFolder.isPending}>
              {t(($) => $.knowledge.folder_dialog.create)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDocDialog({
  node,
  onOpenChange,
  onRenamed,
}: {
  node: DocNode | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: (result: DocMoveResult) => void;
}) {
  const { t } = useT("im");
  const rename = useRenameDoc();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(node);
  if (node && node !== shown) setShown(node);

  useEffect(() => {
    if (!node) return;
    setName(node.type === "file" ? noteTitle(node.name) : node.name);
    setError(null);
  }, [node]);

  const close = () => {
    if (rename.isPending) return;
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!node || rename.isPending) return;
    const next = node.type === "file" ? noteFileName(name) : folderName(name);
    if (!next) {
      setError(t(($) => $.knowledge.dialog.invalid));
      return;
    }
    if (next === node.name) {
      onOpenChange(false);
      return;
    }
    try {
      const result = await rename.mutateAsync({ path: node.path, name: next });
      onOpenChange(false);
      onRenamed(result);
    } catch (err) {
      setError(
        errorCode(err) === "docs_exists"
          ? t(($) => $.knowledge.rename_dialog.exists)
          : t(($) => $.knowledge.rename_dialog.failed),
      );
    }
  };

  const dir = shown ? parentDir(shown.path) : "";
  return (
    <Dialog open={node !== null} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(($) => $.knowledge.rename_dialog.title)}</DialogTitle>
            <DialogDescription className="break-all">
              {locationText(dir, t(($) => $.knowledge.dialog.root), (place) =>
                t(($) => $.knowledge.dialog.location, { dir: place }),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-rename-name">{t(($) => $.knowledge.dialog.name_label)}</Label>
            <Input
              id="knowledge-rename-name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "knowledge-rename-error" : undefined}
            />
            {error && (
              <p id="knowledge-rename-error" className="text-caption text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={rename.isPending} />}>
              {t(($) => $.knowledge.dialog.cancel)}
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || rename.isPending} aria-busy={rename.isPending}>
              {t(($) => $.knowledge.rename_dialog.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDocDialog({
  node,
  onOpenChange,
  onDeleted,
}: {
  node: DocNode | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (path: string) => void;
}) {
  const { t } = useT("im");
  const remove = useDeleteDoc();
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(node);
  if (node && node !== shown) setShown(node);

  useEffect(() => {
    if (node) setError(null);
  }, [node]);

  const close = () => {
    if (remove.isPending) return;
    onOpenChange(false);
  };

  const confirm = async () => {
    if (!node || remove.isPending) return;
    try {
      const result = await remove.mutateAsync({ path: node.path });
      onOpenChange(false);
      onDeleted(result.path);
    } catch (err) {
      if (errorCode(err) === "docs_not_found") {
        onOpenChange(false);
        onDeleted(node.path);
        return;
      }
      setError(t(($) => $.knowledge.delete_dialog.failed));
    }
  };

  return (
    <AlertDialog open={node !== null} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $.knowledge.delete_dialog.title, { name: shown?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {shown?.type === "dir"
              ? t(($) => $.knowledge.delete_dialog.folder)
              : t(($) => $.knowledge.delete_dialog.note)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={remove.isPending}>
            {t(($) => $.knowledge.delete_dialog.cancel)}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void confirm()}
            disabled={remove.isPending}
            aria-busy={remove.isPending}
          >
            {remove.isPending
              ? t(($) => $.knowledge.delete_dialog.deleting)
              : t(($) => $.knowledge.delete_dialog.confirm)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
