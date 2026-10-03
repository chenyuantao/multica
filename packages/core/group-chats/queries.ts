import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { GroupChat } from "../types";

export const GROUP_CHAT_MESSAGE_PAGE_SIZE = 200;

export const groupChatKeys = {
  all: (wsId: string) => ["group-chats", wsId] as const,
  list: (wsId: string) => [...groupChatKeys.all(wsId), "list"] as const,
  messages: (wsId: string, chatId: string) =>
    [...groupChatKeys.all(wsId), "messages", chatId] as const,
  messagesPage: (wsId: string, chatId: string) =>
    [...groupChatKeys.all(wsId), "messages-page", chatId] as const,
  search: (wsId: string, q: string) => [...groupChatKeys.all(wsId), "search", q] as const,
};

export function groupChatListOptions(wsId: string) {
  return queryOptions({
    queryKey: groupChatKeys.list(wsId),
    queryFn: () => api.listGroupChats(),
  });
}

export function groupChatSearchOptions(wsId: string, q: string) {
  return queryOptions({
    queryKey: groupChatKeys.search(wsId, q),
    queryFn: () => api.searchGroupChats(q),
    enabled: q.length > 0,
  });
}

export function groupChatMessagesOptions(wsId: string, chatId: string) {
  return queryOptions({
    queryKey: groupChatKeys.messages(wsId, chatId),
    queryFn: () => api.listComments(chatId),
  });
}

/** Newest page first. The next page is the next-older cursor. */
export function groupChatMessagesPageOptions(wsId: string, chatId: string) {
  return infiniteQueryOptions({
    queryKey: groupChatKeys.messagesPage(wsId, chatId),
    queryFn: ({ pageParam }) =>
      api.listCommentsPage(chatId, { before: pageParam, limit: GROUP_CHAT_MESSAGE_PAGE_SIZE }),
    initialPageParam: null as { created_at: string; id: string } | null,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_cursor ?? undefined : undefined),
    enabled: !!chatId,
  });
}

/**
 * Total unread messages across group chats. `excludeChatId` drops the chat the
 * user is reading right now, whose unread is about to be cleared.
 */
export function countUnreadGroupChatMessages(
  chats: readonly GroupChat[] | undefined,
  excludeChatId?: string | null,
): number {
  if (!chats) return 0;
  return chats.reduce(
    (sum, c) => (c.id === excludeChatId ? sum : sum + (c.unread_count ?? 0)),
    0,
  );
}
