"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthStore } from "@multica/core/auth";
import { findDirectChat, groupChatKeys, useOpenDirectGroupChat } from "@multica/core/group-chats";
import { useWorkspacePaths } from "@multica/core/paths";
import type { GroupChat, GroupChatMemberRef } from "@multica/core/types";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

/**
 * Goes to the user's two-person chat with a person or agent. A chat already
 * in the list opens at once; otherwise the server returns the existing chat or
 * creates it, and navigation waits for that answer.
 */
export function useStartDirectChat(wsId: string) {
  const { t } = useT("im");
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const open = useOpenDirectGroupChat(wsId);

  /** Resolves true once the chat is open; a failure is toasted. */
  const start = async (peer: GroupChatMemberRef): Promise<boolean> => {
    if (open.isPending) return false;
    const cached = qc.getQueryData<GroupChat[]>(groupChatKeys.list(wsId));
    const existing = cached ? findDirectChat(cached, userId, peer) : null;
    if (existing) {
      navigation.push(paths.imChat(existing.id));
      return true;
    }
    try {
      const chat = await open.mutateAsync(peer);
      navigation.push(paths.imChat(chat.id));
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.contacts.send_message_failed));
      return false;
    }
  };

  return { start, isPending: open.isPending };
}
