"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCreateGroupChat } from "@multica/core/group-chats";
import { useAuthStore } from "@multica/core/auth";
import type { GroupChat, GroupChatMemberRef } from "@multica/core/types";
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
import { MemberPicker } from "./member-picker";
import { useStartDirectChat } from "./use-direct-chat";
import { entryKey, useChatDirectory } from "./use-chat-directory";

interface NewChatDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (chat: GroupChat) => void;
  /** `page` fills a phone level whose header carries the title. */
  presentation?: "dialog" | "page";
}

export function NewChatDialog({ wsId, open, onOpenChange, onCreated, presentation = "dialog" }: NewChatDialogProps) {
  const { t } = useT("im");
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const directory = useChatDirectory(wsId);
  const createChat = useCreateGroupChat(wsId);
  const directChat = useStartDirectChat(wsId, { replace: presentation === "page" });
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Map<string, GroupChatMemberRef>>(() => new Map());

  const reset = () => {
    setTitle("");
    setQuery("");
    setPicked(new Map());
  };

  const toggle = (type: GroupChatMemberRef["member_type"], id: string) => {
    setPicked((prev) => {
      const next = new Map(prev);
      const key = entryKey(type, id);
      if (next.has(key)) next.delete(key);
      else next.set(key, { member_type: type, member_id: id });
      return next;
    });
  };

  // One pick is a direct chat: named after the peer, and reused if it exists.
  const directPeer = picked.size === 1 ? [...picked.values()][0]! : null;
  const pending = createChat.isPending || directChat.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (directPeer) {
      if (await directChat.start(directPeer)) {
        reset();
        onOpenChange(false);
      }
      return;
    }
    const name = title.trim();
    if (!name) return;
    try {
      const chat = await createChat.mutateAsync({ title: name, members: [...picked.values()] });
      reset();
      onOpenChange(false);
      onCreated(chat);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.new_chat.failed));
    }
  };

  const fields = (
    <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="im-new-chat-title">{t(($) => $.new_chat.name_label)}</Label>
            <Input
              id="im-new-chat-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(($) => $.new_chat.name_placeholder)}
              disabled={!!directPeer}
            />
            {directPeer && <p className="text-caption text-muted-foreground">{t(($) => $.new_chat.direct_hint)}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium">{t(($) => $.new_chat.members_label)}</span>
            <MemberPicker
              people={directory.people.filter((p) => p.id !== userId)}
              agents={directory.agents}
              query={query}
              onQueryChange={setQuery}
              selected={new Set(picked.keys())}
              onPick={(entry) => toggle(entry.type, entry.id)}
            />
          </div>
    </>
  );
  const submitButton = (
    <Button type="submit" disabled={(!directPeer && !title.trim()) || pending} aria-busy={pending}>
      {directPeer ? t(($) => $.contacts.send_message) : t(($) => $.new_chat.create)}
    </Button>
  );

  if (presentation === "page") {
    return (
      <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <p className="text-caption text-muted-foreground">{t(($) => $.new_chat.description)}</p>
          {fields}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {submitButton}
        </div>
      </form>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(($) => $.new_chat.title)}</DialogTitle>
            <DialogDescription>{t(($) => $.new_chat.description)}</DialogDescription>
          </DialogHeader>
          {fields}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t(($) => $.new_chat.cancel)}
            </DialogClose>
            {submitButton}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
