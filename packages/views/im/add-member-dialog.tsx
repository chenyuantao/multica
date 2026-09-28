"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAddGroupChatMember } from "@multica/core/group-chats";
import type { GroupChat } from "@multica/core/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../i18n";
import { MemberPicker } from "./member-picker";
import { entryKey, useChatDirectory, type DirectoryEntry } from "./use-chat-directory";

interface AddMemberDialogProps {
  wsId: string;
  chat: GroupChat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemberDialog({ wsId, chat, open, onOpenChange }: AddMemberDialogProps) {
  const { t } = useT("im");
  const directory = useChatDirectory(wsId);
  const addMember = useAddGroupChatMember(wsId, chat.id);
  const [query, setQuery] = useState("");

  const inChat = new Set(chat.members.map((m) => entryKey(m.member_type, m.member_id)));
  const notInChat = (e: DirectoryEntry) => !inChat.has(entryKey(e.type, e.id));

  const add = async (entry: DirectoryEntry) => {
    try {
      await addMember.mutateAsync({ member_type: entry.type, member_id: entry.id });
      onOpenChange(false);
      setQuery("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.add_member.failed));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(($) => $.add_member.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.add_member.description)}</DialogDescription>
        </DialogHeader>
        <MemberPicker
          people={directory.people.filter(notInChat)}
          agents={directory.agents.filter(notInChat)}
          query={query}
          onQueryChange={setQuery}
          selected={new Set()}
          onPick={add}
          disabled={addMember.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
