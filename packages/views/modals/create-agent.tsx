"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { AgentConfigurationPanel } from "../agents/create/agent-configuration-panel";
import { useCreateAgentForm } from "../agents/create/use-create-agent-form";
import { useCreateAgentSubmit } from "../agents/create/use-create-agent-submit";
import { useT } from "../i18n";

/**
 * Blank agent creation as a modal over the current route: the same form and
 * submit path as `/agents/new/manual`, but it closes on success instead of
 * navigating to the new agent. The draft is not persisted — dismissing the
 * modal abandons it.
 */
export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const { t } = useT("agents");
  const form = useCreateAgentForm();
  const submit = useCreateAgentSubmit({
    draft: form.draft,
    runtimeId: form.selectedRuntime?.id ?? null,
    squadId: null,
    onComplete: onClose,
  });

  const canCreate =
    form.draft.name.trim().length > 0 && form.draftReady && !submit.creating;

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !submit.creating) onClose();
      }}
    >
      <DialogContent className="flex h-[min(56rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-0 border-b py-3 pr-12 pl-5">
          <DialogTitle className="text-title-sm font-semibold">
            {t(($) => $.create_dialog.title_create)}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <AgentConfigurationPanel
            draft={form.draft}
            onChange={form.setDraft}
            runtimes={form.runtimes}
            runtimesLoading={form.runtimesLoading}
            members={form.members}
            currentUserId={form.currentUserId}
            nameError={submit.nameError}
            onNameChange={(name) => {
              submit.clearNameError();
              form.setDraft((current) => ({ ...current, name }));
            }}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3">
          {submit.formError && (
            <p
              role="alert"
              className="min-w-0 flex-1 break-words text-body text-destructive"
            >
              {submit.formError}
            </p>
          )}
          <Button
            variant="ghost"
            className="ml-auto shrink-0"
            onClick={onClose}
            disabled={submit.creating}
          >
            {t(($) => $.create_dialog.cancel)}
          </Button>
          <Button
            className="shrink-0"
            onClick={() => void submit.create()}
            disabled={!canCreate}
          >
            {submit.creating && <Loader2 className="size-4 animate-spin" />}
            {submit.creating
              ? t(($) => $.create_dialog.creating)
              : t(($) => $.create_dialog.create)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
