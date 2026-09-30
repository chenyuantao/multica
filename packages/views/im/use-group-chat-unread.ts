"use client";

import { useQuery } from "@tanstack/react-query";
import { countUnreadGroupChatMessages, groupChatListOptions } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import type { GroupChat } from "@multica/core/types";
import { useAppForeground } from "../common/use-app-foreground";

/**
 * Unread messages across the user's group chats, for the Chats section badge.
 * `readingChatId` is the chat on screen; it is read as soon as it lands while
 * the app is in front, so it only counts while the app is backgrounded.
 */
export function useGroupChatUnreadTotal(readingChatId?: string | null): number {
  const wsId = useWorkspaceId();
  const foreground = useAppForeground();
  const exclude = foreground ? readingChatId : null;
  const { data = 0 } = useQuery({
    ...groupChatListOptions(wsId),
    select: (chats: GroupChat[]) => countUnreadGroupChatMessages(chats, exclude),
  });
  return data;
}
