"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@multica/core/auth";
import { useCreateReminder } from "@multica/core/reminders";
import type { Reminder } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../i18n";
import { resolveTitleMentions, type ComposerMention } from "./im-utils";
import { ReminderTitleField } from "./reminder-title-field";
import { toDateKey } from "./reminder-dates";
import { useChatDirectory } from "./use-chat-directory";

interface NewTaskDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (reminder: Reminder) => void;
}

/**
 * Creates today's task the way the reminder page creates today's to-do:
 * the note is the description, a title is generated later, and an @mention
 * assigns that agent. The task stays in the chat list before anyone writes.
 */
export function NewTaskDialog({ wsId, open, onOpenChange, onCreated }: NewTaskDialogProps) {
  const { t } = useT("im");
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const directory = useChatDirectory(wsId);
  const create = useCreateReminder(wsId);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ComposerMention[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);

  const candidates = useMemo<ComposerMention[]>(
    () => [
      ...directory.people.filter((person) => person.id !== userId).map((person) => ({
        type: "member" as const,
        id: person.id,
        name: person.name,
      })),
      ...directory.agents.map((agent) => ({ type: "agent" as const, id: agent.id, name: agent.name })),
    ],
    [directory.agents, directory.people, userId],
  );

  const reset = () => {
    setText("");
    setPicked([]);
    setNameError(null);
  };

  const pending = create.isPending;
  const commit = () => {
    if (pending) return;
    const note = text.trim();
    if (!note) return;
    const resolved = resolveTitleMentions(note, picked, candidates);
    if (!resolved.ok) {
      setNameError(resolved.name);
      return;
    }
    setNameError(null);
    void create
      .mutateAsync({ description: resolved.markdown, due_date: toDateKey(new Date()), task: true })
      .then((created) => {
        reset();
        onOpenChange(false);
        onCreated(created);
      })
      .catch(() => toast.error(t(($) => $.new_task.failed)));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(($) => $.new_task.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.new_task.description)}</DialogDescription>
        </DialogHeader>
        <ReminderTitleField
          id="im-new-task"
          multiline
          commitOnBlur={false}
          value={text}
          onChange={setText}
          picked={picked}
          onPickedChange={setPicked}
          candidates={candidates}
          errorName={nameError}
          onCommit={commit}
          onCancel={() => {
            if (pending) return;
            reset();
            onOpenChange(false);
          }}
          disabled={pending}
          placeholder={t(($) => $.new_task.placeholder)}
          ariaLabel={t(($) => $.new_task.label)}
          inputClassName="min-h-28 resize-none rounded-lg px-3 py-2 ring-1 ring-surface-border focus-visible:ring-2 focus-visible:ring-ring"
        />
        <DialogFooter>
          <Button type="button" disabled={!text.trim() || pending} aria-busy={pending} onClick={commit}>
            {t(($) => $.new_task.create)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
