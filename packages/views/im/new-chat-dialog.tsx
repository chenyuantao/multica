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
import { entryKey, useChatDirectory } from "./use-chat-directory";

interface NewChatDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (chat: GroupChat) => void;
}

export function NewChatDialog({ wsId, open, onOpenChange, onCreated }: NewChatDialogProps) {
  const { t } = useT("im");
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const directory = useChatDirectory(wsId);
  const createChat = useCreateGroupChat(wsId);
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name || createChat.isPending) return;
    try {
      const chat = await createChat.mutateAsync({ title: name, members: [...picked.values()] });
      reset();
      onOpenChange(false);
      onCreated(chat);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.new_chat.failed));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(($) => $.new_chat.title)}</DialogTitle>
            <DialogDescription>{t(($) => $.new_chat.description)}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="im-new-chat-title">{t(($) => $.new_chat.name_label)}</Label>
            <Input
              id="im-new-chat-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(($) => $.new_chat.name_placeholder)}
            />
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
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t(($) => $.new_chat.cancel)}
            </DialogClose>
            <Button type="submit" disabled={!title.trim() || createChat.isPending} aria-busy={createChat.isPending}>
              {t(($) => $.new_chat.create)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
