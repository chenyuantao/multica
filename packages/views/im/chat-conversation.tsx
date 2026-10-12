"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { directChatPeer, groupChatKeys } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import type { AskAISelection, Comment, GroupChat } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { chatAskPage, visibleMessageIds } from "./ask-ai-context";
import { ChatHistoryRoute } from "./chat-history-view";
import { ChatProgressRoute } from "./chat-progress-view";
import { ChatSidePanel } from "./chat-side-panel";
import { ChatThread } from "./chat-thread";
import { DocExcerptInsertProvider } from "./doc-excerpt-insert";
import { DocExcerptRevealProvider } from "./doc-excerpt-reveal";
import { chatDisplayTitle, type ComposerMention } from "./im-utils";
import {
  closeKnowledgeNote,
  knowledgeNoteTabsFor,
  KnowledgeNotesProvider,
  openKnowledgeNote,
  updateKnowledgeNoteTabs,
  type KnowledgeNoteTab,
  type KnowledgeNoteTabs,
  type KnowledgeNoteTabsByChat,
} from "./knowledge-note-tabs";
import { MobileContactDetail, MobileLevel, parseContactParam } from "./mobile-shell";
import { useAskAILauncher } from "./use-ask-ai-launcher";

/** Page links for one conversation. `/im` and `/reminder` each supply their own. */
export interface ChatConversationRoutes {
  list: () => string;
  chat: (chatId: string) => string;
  contact: (chatId: string, actorType: string, actorId: string) => string;
  settings: (chatId: string) => string;
  settingsContact: (chatId: string, actorType: string, actorId: string) => string;
  history: (chatId: string, messageId: string, nest?: string) => string;
  progress: (chatId: string, taskId: string) => string;
}

export interface ChatConversationState {
  panelOpen: boolean;
  togglePanel: () => void;
  noteTabs: KnowledgeNoteTabs;
  focusedNote: KnowledgeNoteTab | null;
  patchNoteTabs: (update: (tabs: KnowledgeNoteTabs) => KnowledgeNoteTabs) => void;
  openNote: (note: KnowledgeNoteTab) => void;
}

/**
 * Sidebar tabs for the open conversation. The page owns this so leaving the
 * thread and coming back keeps the open documents.
 */
export function useChatConversation(chatId: string | null): ChatConversationState {
  const [panelOpen, setPanelOpen] = useState(true);
  const [noteTabsByChat, setNoteTabsByChat] = useState<KnowledgeNoteTabsByChat>({});
  const noteTabs = knowledgeNoteTabsFor(noteTabsByChat, chatId);
  const focusedNote = noteTabs.notes.find((note) => note.path === noteTabs.activePath) ?? null;
  const patchNoteTabs = useCallback(
    (update: (tabs: KnowledgeNoteTabs) => KnowledgeNoteTabs) => {
      if (!chatId) return;
      setNoteTabsByChat((byChat) => updateKnowledgeNoteTabs(byChat, chatId, update));
    },
    [chatId],
  );
  const openNote = useCallback(
    (note: KnowledgeNoteTab) => {
      patchNoteTabs((state) => openKnowledgeNote(state, note));
      setPanelOpen(true);
    },
    [patchNoteTabs],
  );
  return { panelOpen, togglePanel: () => setPanelOpen((open) => !open), noteTabs, focusedNote, patchNoteTabs, openNote };
}

/**
 * Opens a document in the sidebar. On a phone the settings level is where
 * that sidebar lives, so the first open pushes it.
 */
export function useOpenChatNote(conversation: ChatConversationState, settingsHref: string | null) {
  const isMobile = useIsMobile();
  const navigation = useNavigation();
  const openNote = conversation.openNote;
  return useCallback(
    (note: KnowledgeNoteTab) => {
      openNote(note);
      if (!isMobile || !settingsHref) return;
      if (navigation.searchParams.get("view") === "settings") return;
      navigation.push(settingsHref);
    },
    [isMobile, navigation, openNote, settingsHref],
  );
}

/** Ask AI about the open conversation. A null chat sends no page context. */
export function useChatAskLauncher(chat: GroupChat | null, userId: string) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { getActorName } = useActorName();
  return useAskAILauncher(() => {
    if (!chat) return null;
    const messages = qc.getQueryData<Comment[]>(groupChatKeys.messages(wsId, chat.id)) ?? [];
    return chatAskPage(chat, chatDisplayTitle(chat, userId, getActorName), messages, visibleMessageIds(), getActorName);
  });
}

/** Knowledge notes plus the passage that travels between a document and the composer. */
export function ChatSurfaceProviders({
  onOpen,
  children,
}: {
  onOpen: (note: KnowledgeNoteTab) => void;
  children: ReactNode;
}) {
  return (
    <KnowledgeNotesProvider onOpen={onOpen}>
      <DocExcerptInsertProvider>
        <DocExcerptRevealProvider onOpen={onOpen}>{children}</DocExcerptRevealProvider>
      </DocExcerptInsertProvider>
    </KnowledgeNotesProvider>
  );
}

interface ChatConversationProps {
  wsId: string;
  chat: GroupChat;
  userId: string;
  routes: ChatConversationRoutes;
  /** Phone back control, from the thread to this page's list. */
  backLabel: string;
  state: ChatConversationState;
  onAskAI?: (selection?: AskAISelection) => void;
  /** Desktop dismiss. The details sidebar stays available until then. */
  onClose?: () => void;
  mentionCandidates?: ComposerMention[];
  focusComposer?: boolean;
}

/**
 * The conversation and its details sidebar, shared by `/im` and reminders.
 * Desktop is the thread plus the resizable sidebar (group info, announcement,
 * and any document opened from a card). A phone uses the same stacked levels
 * as a chat: profile, settings, forwarded history, and a run log.
 */
export function ChatConversation({
  wsId,
  chat,
  userId,
  routes,
  backLabel,
  state,
  onAskAI,
  onClose,
  mentionCandidates,
  focusComposer,
}: ChatConversationProps) {
  const { t } = useT("im");
  const navigation = useNavigation();
  const isMobile = useIsMobile();
  const peer = directChatPeer(chat, userId);
  const settingsHref = peer
    ? routes.contact(chat.id, peer.member_type, peer.member_id)
    : routes.settings(chat.id);
  const notes = state.noteTabs.notes;
  const activePath = state.noteTabs.activePath;

  const selectDetails = () => state.patchNoteTabs((tabs) => ({ ...tabs, activePath: null }));
  const selectNote = (path: string) => state.patchNoteTabs((tabs) => ({ ...tabs, activePath: path }));
  const closeNote = (path: string) => state.patchNoteTabs((tabs) => closeKnowledgeNote(tabs, path));

  if (isMobile) {
    const contact = parseContactParam(navigation.searchParams.get("contact"));
    const view = navigation.searchParams.get("view");
    if (contact) {
      return (
        <MobileContactDetail
          contact={contact}
          backHref={view === "settings" ? routes.settings(chat.id) : routes.chat(chat.id)}
          backLabel={view === "settings" ? t(($) => $.panel.back_to_settings) : t(($) => $.panel.back)}
        />
      );
    }
    if (view === "history") {
      return (
        <ChatHistoryRoute
          wsId={wsId}
          chatId={chat.id}
          messageId={navigation.searchParams.get("message") ?? ""}
          nest={navigation.searchParams.get("nest")}
          hrefs={{ chat: routes.chat, history: routes.history }}
        />
      );
    }
    if (view === "progress") {
      return (
        <ChatProgressRoute
          chatId={chat.id}
          taskId={navigation.searchParams.get("task") ?? ""}
          backHref={routes.chat(chat.id)}
        />
      );
    }
    if (view === "settings") {
      return (
        <MobileLevel title={t(($) => $.thread.settings)} backHref={routes.chat(chat.id)} backLabel={t(($) => $.panel.back)}>
          <ChatSidePanel
            wsId={wsId}
            chat={chat}
            userId={userId}
            notes={notes}
            activePath={activePath}
            onSelectDetails={selectDetails}
            onSelectNote={selectNote}
            onCloseNote={closeNote}
            onReturnToComposer={() => navigation.push(routes.chat(chat.id))}
            chrome="page"
            onOpenMember={(member) =>
              navigation.push(routes.settingsContact(chat.id, member.member_type, member.member_id))
            }
          />
        </MobileLevel>
      );
    }
    return (
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
        <ChatThread
          key={chat.id}
          wsId={wsId}
          chat={chat}
          userId={userId}
          panelOpen={false}
          onTogglePanel={() => {}}
          onAskAI={onAskAI}
          focusNote={state.focusedNote}
          mentionCandidates={mentionCandidates}
          focusComposer={focusComposer}
          mobileNav={{
            backHref: routes.list(),
            backLabel,
            settingsHref,
            onOpenProfile: (type, id) => navigation.push(routes.contact(chat.id, type, id)),
            onOpenHistory: (messageId) => navigation.push(routes.history(chat.id, messageId)),
            onOpenProgress: (taskId) => navigation.push(routes.progress(chat.id, taskId)),
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <ChatThread
        key={chat.id}
        wsId={wsId}
        chat={chat}
        userId={userId}
        panelOpen={state.panelOpen}
        onTogglePanel={state.togglePanel}
        onAskAI={onAskAI}
        focusNote={state.focusedNote}
        mentionCandidates={mentionCandidates}
        focusComposer={focusComposer}
        onClose={onClose}
      />
      {state.panelOpen && (
        <ChatSidePanel
          wsId={wsId}
          chat={chat}
          userId={userId}
          notes={notes}
          activePath={activePath}
          onSelectDetails={selectDetails}
          onSelectNote={selectNote}
          onCloseNote={closeNote}
        />
      )}
    </div>
  );
}
