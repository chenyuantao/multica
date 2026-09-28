import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Comment,
  CreateGroupChatRequest,
  GroupChat,
  GroupChatMemberRef,
  GroupChatMemberType,
} from "../types";
import { groupChatKeys } from "./queries";

function upsertChat(list: GroupChat[] | undefined, chat: GroupChat): GroupChat[] {
  const rest = (list ?? []).filter((c) => c.id !== chat.id);
  return [chat, ...rest];
}

export function useCreateGroupChat(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGroupChatRequest) => api.createGroupChat(data),
    onSuccess: (chat) => {
      qc.setQueryData<GroupChat[]>(groupChatKeys.list(wsId), (old) => upsertChat(old, chat));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) }),
  });
}

export function useRenameGroupChat(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => api.renameGroupChat(chatId, title),
    onSuccess: (chat) => {
      if (!chat) return;
      qc.setQueryData<GroupChat[]>(groupChatKeys.list(wsId), (old) =>
        old?.map((c) => (c.id === chat.id ? { ...c, title: chat.title } : c)),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) }),
  });
}

export function useAddGroupChatMember(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (member: GroupChatMemberRef) => api.addGroupChatMember(chatId, member),
    onSettled: () => qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) }),
  });
}

export function useRemoveGroupChatMember(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberType, memberId }: { memberType: GroupChatMemberType; memberId: string }) =>
      api.removeGroupChatMember(chatId, memberType, memberId),
    onSettled: () => qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) }),
  });
}

export function useSendGroupChatMessage(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.createComment(chatId, content),
    onSuccess: (comment) => {
      qc.setQueryData<Comment[]>(groupChatKeys.messages(wsId, chatId), (old) =>
        old && !old.some((c) => c.id === comment.id) ? [...old, comment] : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: groupChatKeys.messages(wsId, chatId) });
      qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) });
    },
  });
}
