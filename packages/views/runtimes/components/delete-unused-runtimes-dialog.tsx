"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AgentRuntime } from "@multica/core/types";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { useDeleteUnusedRuntimes } from "@multica/core/runtimes/mutations";
import {
  AlertDialog,
  AlertDialogContent,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import { useT, useTimeAgo } from "../../i18n";
import { ProviderLogo } from "./provider-logo";

export interface DeleteUnusedRuntimesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtimes: AgentRuntime[];
  wsId: string;
}

export function DeleteUnusedRuntimesDialog({
  open,
  onOpenChange,
  runtimes,
  wsId,
}: DeleteUnusedRuntimesDialogProps) {
  const { t } = useT("runtimes");
  const timeAgo = useTimeAgo();
  const deleteUnused = useDeleteUnusedRuntimes(wsId);
  const [submitting, setSubmitting] = useState(false);
  const count = runtimes.length;

  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const result = await deleteUnused.mutateAsync(runtimes.map((rt) => rt.id));
      if (result.deleted_ids.length > 0) {
        toast.success(
          t(($) => $.cleanup.deleted_toast, { count: result.deleted_ids.length }),
        );
      }
      if (result.skipped_ids.length > 0) {
        toast.info(
          t(($) => $.cleanup.skipped_toast, { count: result.skipped_ids.length }),
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.cleanup.failed_toast),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] !max-w-[480px] gap-0 overflow-hidden p-0">
        <div className="px-5 pb-4 pt-5">
          <h2 className="text-title-sm font-semibold">
            {t(($) => $.cleanup.title, { count })}
          </h2>
          <p className="mt-1 text-body leading-5 text-muted-foreground">
            {t(($) => $.cleanup.description)}
          </p>
          <ul className="mt-3 max-h-[240px] divide-y overflow-y-auto rounded-md border">
            {runtimes.map((runtime) => (
              <li
                key={runtime.id}
                className="flex min-w-0 items-center gap-2 px-3 py-2 text-caption"
              >
                <ProviderLogo
                  provider={runtime.provider}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {runtimeDisplayLabel(runtime)}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {runtime.last_seen_at ? timeAgo(runtime.last_seen_at) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t bg-muted/25 px-5 py-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t(($) => $.cleanup.cancel)}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={handleConfirm}
              disabled={submitting || count === 0}
            >
              {submitting
                ? t(($) => $.cleanup.submitting)
                : t(($) => $.cleanup.confirm, { count })}
            </Button>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
