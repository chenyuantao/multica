import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Comment,
  CreateGroupChatRequest,
  GroupChat,
  GroupChatMemberRef,
  GroupChatMemberType,
  UpdateGroupChatRequest,
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

/** Opens the two-person chat with a peer, reusing it when the server already has one. */
export function useOpenDirectGroupChat(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (peer: GroupChatMemberRef) => api.openDirectGroupChat(peer),
    onSuccess: (chat) => {
      qc.setQueryData<GroupChat[]>(groupChatKeys.list(wsId), (old) => upsertChat(old, chat));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) }),
  });
}

export function useUpdateGroupChat(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateGroupChatRequest) => api.updateGroupChat(chatId, data),
    onSuccess: (chat) => {
      if (!chat) return;
      qc.setQueryData<GroupChat[]>(groupChatKeys.list(wsId), (old) =>
        old?.map((c) => (c.id === chat.id ? { ...c, title: chat.title, description: chat.description } : c)),
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
    mutationFn: ({ content, attachmentIds, refMessageId }: { content: string; attachmentIds?: string[]; refMessageId?: string }) =>
      api.createComment(chatId, content, undefined, undefined, attachmentIds, undefined, undefined, refMessageId),
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

export function useDeleteGroupChatMessage(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.deleteComment(messageId),
    onSuccess: (_, messageId) => {
      qc.setQueryData<Comment[]>(groupChatKeys.messages(wsId, chatId), (old) => old?.filter((c) => c.id !== messageId));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: groupChatKeys.messages(wsId, chatId) });
      qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) });
    },
  });
}
