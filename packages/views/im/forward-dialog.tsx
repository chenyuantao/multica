"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { ForwardChatHistoryResult } from "@multica/core/group-chats";
import type { GroupChat } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { useActorName } from "@multica/core/workspace/hooks";
import { useT } from "../i18n";
import { ChatAvatar } from "./chat-sidebar";
import { chatDisplayTitle, sortChats } from "./im-utils";

interface ForwardDialogProps {
  open: boolean;
  chats: GroupChat[];
  userId: string;
  loading?: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targets: string[], note: string) => Promise<ForwardChatHistoryResult | null>;
  onDone: () => void;
}

/** Pick one or more chats, optionally add a message sent after the history card. */
export function ForwardDialog({
  open,
  chats,
  userId,
  loading,
  pending,
  onOpenChange,
  onConfirm,
  onDone,
}: ForwardDialogProps) {
  const { t } = useT("im");
  const { getActorName } = useActorName();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState("");

  const q = query.trim().toLowerCase();
  const visible = sortChats(chats).filter((chat) =>
    chatDisplayTitle(chat, userId, getActorName).toLowerCase().includes(q),
  );

  const toggle = (id: string) => {
    if (pending) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    if (pending || picked.size === 0) return;
    const result = await onConfirm([...picked], note);
    if (!result) return;
    if (result.failed.length === 0) {
      onDone();
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of result.sent) next.delete(id);
      return next;
    });
  };

  const close = () => {
    if (!pending) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(($) => $.thread.forward_title)}</DialogTitle>
          <DialogDescription>{t(($) => $.thread.forward_description)}</DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(($) => $.thread.forward_search)}
          aria-label={t(($) => $.thread.forward_search)}
          disabled={pending}
        />
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {visible.map((chat) => {
            const selected = picked.has(chat.id);
            const title = chatDisplayTitle(chat, userId, getActorName);
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={pending}
                  onClick={() => toggle(chat.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left",
                    selected ? "bg-accent hover:bg-accent" : "hover:bg-foreground/5",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                    )}
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                  <ChatAvatar chat={chat} userId={userId} />
                  <span className="min-w-0 flex-1 truncate text-body">{title}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!loading && visible.length === 0 && (
          <p className="text-caption text-muted-foreground">
            {q ? t(($) => $.thread.forward_no_results) : t(($) => $.thread.forward_empty)}
          </p>
        )}
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t(($) => $.thread.forward_note)}
          aria-label={t(($) => $.thread.forward_note)}
          rows={2}
          maxLength={4000}
          disabled={pending}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            {t(($) => $.thread.cancel)}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={picked.size === 0 || pending} aria-busy={pending}>
            {pending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
            {t(($) => $.thread.forward_confirm)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
