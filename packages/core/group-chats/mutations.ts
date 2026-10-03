import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { attachmentMarkdown } from "../hooks/use-file-upload";
import type {
  AskAIPage,
  Comment,
  CommentPage,
  FocusNote,
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

function refreshChatMessages(qc: QueryClient, wsId: string, chatId: string) {
  qc.invalidateQueries({ queryKey: groupChatKeys.messages(wsId, chatId) });
  qc.invalidateQueries({ queryKey: groupChatKeys.messagesPage(wsId, chatId) });
}

/** The first page is the newest window, chronological, so a new message goes on its end. */
function appendChatMessage(
  old: InfiniteData<CommentPage> | undefined,
  comment: Comment,
): InfiniteData<CommentPage> | undefined {
  const [latest, ...older] = old?.pages ?? [];
  if (!old || !latest) return old;
  if (latest.comments.some((c) => c.id === comment.id)) return old;
  return { ...old, pages: [{ ...latest, comments: [...latest.comments, comment] }, ...older] };
}

function dropChatMessage(old: InfiniteData<CommentPage> | undefined, messageId: string) {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((page) => ({ ...page, comments: page.comments.filter((c) => c.id !== messageId) })),
  };
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
      qc.setQueryData<InfiniteData<CommentPage>>(groupChatKeys.messagesPage(wsId, chat.id), (old) =>
        appendChatMessage(old, message),
      );
    },
    onSettled: (result) => {
      qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) });
      if (result) refreshChatMessages(qc, wsId, result.chat.id);
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

export interface ForwardChatHistoryResult {
  sent: string[];
  failed: string[];
  /** Targets whose history card was posted but whose extra message was not. */
  noteFailed: string[];
}

/** Posts one history card to each chat, then the optional note after it. */
export function useForwardChatHistory(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ targets, card, note }: { targets: string[]; card: string; note: string }): Promise<ForwardChatHistoryResult> => {
      const extra = note.trim();
      const sent: string[] = [];
      const failed: string[] = [];
      const noteFailed: string[] = [];
      for (const chatId of targets) {
        try {
          await api.createComment(chatId, card);
        } catch {
          failed.push(chatId);
          continue;
        }
        if (extra) {
          try {
            await api.createComment(chatId, extra);
          } catch {
            noteFailed.push(chatId);
          }
        }
        sent.push(chatId);
      }
      if (sent.length === 0) throw new Error("forward failed");
      return { sent, failed, noteFailed };
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) });
      if (!vars) return;
      for (const id of vars.targets) refreshChatMessages(qc, wsId, id);
    },
  });
}

export function useSendGroupChatMessage(wsId: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      content,
      attachmentIds,
      refMessageId,
      focusNote,
    }: {
      content: string;
      attachmentIds?: string[];
      refMessageId?: string;
      focusNote?: FocusNote;
    }) => api.createComment(chatId, content, undefined, undefined, attachmentIds, undefined, undefined, refMessageId, undefined, focusNote),
    onSuccess: (comment) => {
      qc.setQueryData<Comment[]>(groupChatKeys.messages(wsId, chatId), (old) =>
        old && !old.some((c) => c.id === comment.id) ? [...old, comment] : old,
      );
      qc.setQueryData<InfiniteData<CommentPage>>(groupChatKeys.messagesPage(wsId, chatId), (old) =>
        appendChatMessage(old, comment),
      );
    },
    onSettled: () => {
      refreshChatMessages(qc, wsId, chatId);
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
      qc.setQueryData<InfiniteData<CommentPage>>(groupChatKeys.messagesPage(wsId, chatId), (old) =>
        dropChatMessage(old, messageId),
      );
    },
    onSettled: () => {
      refreshChatMessages(qc, wsId, chatId);
      qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) });
    },
  });
}
