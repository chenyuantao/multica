import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const groupChatKeys = {
  all: (wsId: string) => ["group-chats", wsId] as const,
  list: (wsId: string) => [...groupChatKeys.all(wsId), "list"] as const,
  messages: (wsId: string, chatId: string) =>
    [...groupChatKeys.all(wsId), "messages", chatId] as const,
};

export function groupChatListOptions(wsId: string) {
  return queryOptions({
    queryKey: groupChatKeys.list(wsId),
    queryFn: () => api.listGroupChats(),
  });
}

export function groupChatMessagesOptions(wsId: string, chatId: string) {
  return queryOptions({
    queryKey: groupChatKeys.messages(wsId, chatId),
    queryFn: () => api.listComments(chatId),
  });
}
