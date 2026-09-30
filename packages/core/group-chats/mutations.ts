import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { attachmentMarkdown } from "../hooks/use-file-upload";
import type {
  AskAIPage,
  Comment,
  CreateGroupChatRequest,
  GroupChat,
  GroupChatMemberRef,
  GroupChatMemberType,
  UpdateGroupChatRequest,
} from "../types";
import { onInboxInvalidate, onInboxSummaryInvalidate } from "../inbox/ws-updaters";
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

export interface AskAIVariables {
  query: string;
  page: AskAIPage | null;
  /** Uploaded into the chosen chat once it is known, then attached to the question. */
  files?: File[];
}

/**
 * Asks AI: the server picks the agent, then the question and its files go to
 * the user's direct chat with it. The page travels with the message so the
 * answering agent reads the same context. Resolves with that chat.
 */
export function useAskAI(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ query, page, files = [] }: AskAIVariables) => {
      const agentId = await api.askAI({
        query,
        page,
        ...(files.length ? { attachments: files.map((f) => ({ name: f.name, content_type: f.type })) } : {}),
      });
      if (!agentId) throw new Error("No agent was chosen");
      const chat = await api.openDirectGroupChat({ member_type: "agent", member_id: agentId });
      const uploaded = await Promise.all(files.map((file) => api.uploadFile(file, { issueId: chat.id })));
      const content = [query, ...uploaded.map(attachmentMarkdown)].filter(Boolean).join("\n\n");
      const message = await api.createComment(
        chat.id,
        content,
        undefined,
        undefined,
        uploaded.map((a) => a.id),
        undefined,
        undefined,
        undefined,
        page,
      );
      return { chat, message };
    },
    onSuccess: ({ chat, message }) => {
      qc.setQueryData<GroupChat[]>(groupChatKeys.list(wsId), (old) => upsertChat(old, chat));
      qc.setQueryData<Comment[]>(groupChatKeys.messages(wsId, chat.id), (old) =>
        old && !old.some((c) => c.id === message.id) ? [...old, message] : old,
      );
    },
    onSettled: (result) => {
      qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) });
      if (result) qc.invalidateQueries({ queryKey: groupChatKeys.messages(wsId, result.chat.id) });
    },
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

/**
 * Read every unread message of a chat. The chat's own count drops at once; the
 * inbox and the app badge follow the server's answer.
 */
export function useMarkGroupChatRead(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markGroupChatRead(chatId),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: groupChatKeys.list(wsId) });
      const prev = qc.getQueryData<GroupChat[]>(groupChatKeys.list(wsId));
      qc.setQueryData<GroupChat[]>(groupChatKeys.list(wsId), (old) =>
        old?.map((c) => (c.id === chatId ? { ...c, unread_count: 0 } : c)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(groupChatKeys.list(wsId), ctx.prev);
    },
    onSettled: () => {
      void onInboxInvalidate(qc, wsId);
      void onInboxSummaryInvalidate(qc);
    },
  });
}

/** Pins or unpins a chat in the current user's list; the row moves at once. */
export function useSetGroupChatPinned(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, pinned }: { chatId: string; pinned: boolean }) => api.setGroupChatPinned(chatId, pinned),
    onMutate: async ({ chatId, pinned }) => {
      await qc.cancelQueries({ queryKey: groupChatKeys.list(wsId) });
      const prev = qc.getQueryData<GroupChat[]>(groupChatKeys.list(wsId));
      qc.setQueryData<GroupChat[]>(groupChatKeys.list(wsId), (old) =>
        old?.map((c) => (c.id === chatId ? { ...c, pinned } : c)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(groupChatKeys.list(wsId), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) }),
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
