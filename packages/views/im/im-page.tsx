"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useModalStore } from "@multica/core/modals";
import { useWorkspacePaths } from "@multica/core/paths";
import { directChatPeer, groupChatKeys, groupChatListOptions, useGroupChatRealtime, useSetGroupChatPinned } from "@multica/core/group-chats";
import type { Comment, GroupChat } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { Button } from "@multica/ui/components/ui/button";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { AppLink, useNavigation } from "../navigation";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { chatAskPage, contactAskPage, visibleMessageIds } from "./ask-ai-context";
import { DocExcerptInsertProvider } from "./doc-excerpt-insert";
import { DocExcerptRevealProvider } from "./doc-excerpt-reveal";
import { ChatDetailsPanel } from "./chat-details-panel";
import { ChatSidePanel } from "./chat-side-panel";
import { ChatHistoryRoute } from "./chat-history-view";
import { ChatProgressRoute } from "./chat-progress-view";
import { ChatSidebar } from "./chat-sidebar";
import { ChatThread } from "./chat-thread";
import { ContactCard } from "./contact-card";
import { ContactList } from "./contact-list";
import { ImRail, type ImView } from "./im-rail";
import { MeSectionTabs } from "./me-section-tabs";
import { ImSearchDialog } from "./im-search-dialog";
import { MobileContactDetail, MobileLevel, MobileTabScreen, parseContactParam } from "./mobile-shell";
import { chatDisplayTitle, sortChats } from "./im-utils";
import { NewChatDialog } from "./new-chat-dialog";
import { CreateAgentModal } from "../modals/create-agent";
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
import { useAskAILauncher } from "./use-ask-ai-launcher";
import { entryKey, useChatDirectory, type DirectoryEntry } from "./use-chat-directory";

const EMPTY_CHATS: GroupChat[] = [];

/**
 * Full-window group chat surface. Deliberately outside the dashboard shell:
 * it owns its own sidebar, thread and details columns. The rail section is
 * route-driven: chats (`/im`) and contacts (`/member`). On phones each
 * section is a bottom tab whose list is the root, and the columns become
 * route-driven levels: thread (`?chat=`), settings (`&view=settings`), a
 * run log (`&view=progress`), and a profile (`&contact=type:id`) opened
 * from either. On `/member` a profile is one level, and a group (`?chat=`)
 * opens its details before the thread.
 */
export function ImPage({ view = "chats" }: { view?: ImView }) {
  const { t } = useT("im");
  const { t: tAgents } = useT("agents");
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { getActorName } = useActorName();
  const { data = EMPTY_CHATS, isLoading, isError } = useQuery(groupChatListOptions(wsId));
  const [panelOpen, setPanelOpen] = useState(true);
  const [noteTabsByChat, setNoteTabsByChat] = useState<KnowledgeNoteTabsByChat>({});
  const [newChatOpen, setNewChatOpen] = useState(false);
  const contactTarget = parseContactParam(navigation.searchParams.get("contact"));
  const directory = useChatDirectory(wsId);
  const setPinned = useSetGroupChatPinned(wsId);
  const setChatPinned = (chatId: string, pinned: boolean) =>
    setPinned.mutate(
      { chatId, pinned },
      { onError: (err) => toast.error(err instanceof Error ? err.message : t(($) => $.sidebar.pin_failed)) },
    );

  useGroupChatRealtime(wsId);

  const chats = useMemo(() => sortChats(data), [data]);
  const requestedId = view === "chats" ? navigation.searchParams.get("chat") : null;
  const requested = chats.find((c) => c.id === requestedId) ?? null;
  const selected = requested ?? (requestedId || isMobile ? null : chats[0] ?? null);
  const memberChatId = view === "contacts" ? navigation.searchParams.get("chat") : null;
  const memberChat = memberChatId ? chats.find((c) => c.id === memberChatId) ?? null : null;
  const sessionId = view === "chats" ? selected?.id ?? null : null;
  const noteTabs = knowledgeNoteTabsFor(noteTabsByChat, sessionId);
  const focusedNote = noteTabs.notes.find((note) => note.path === noteTabs.activePath) ?? null;
  const patchNoteTabs = useCallback(
    (update: (tabs: KnowledgeNoteTabs) => KnowledgeNoteTabs) => {
      if (!sessionId) return;
      setNoteTabsByChat((byChat) => updateKnowledgeNoteTabs(byChat, sessionId, update));
    },
    [sessionId],
  );

  const select = (chatId: string) =>
    isMobile ? navigation.push(paths.imChat(chatId)) : navigation.replace(paths.imChat(chatId));

  const openMemberChat = (chatId: string) =>
    isMobile ? navigation.push(paths.memberChat(chatId)) : navigation.replace(paths.memberChat(chatId));

  const contactKey = contactTarget ? entryKey(contactTarget.type, contactTarget.id) : null;
  const contact = contactKey ? directory.byKey.get(contactKey) ?? null : null;
  const selectContact = (entry: DirectoryEntry) =>
    isMobile
      ? navigation.push(paths.memberContact(entry.type, entry.id))
      : navigation.replace(paths.memberContact(entry.type, entry.id));

  const askPage = () => {
    if (view === "contacts") return contact ? contactAskPage(contact) : null;
    if (!selected || (isMobile && !requested)) return null;
    const messages = qc.getQueryData<Comment[]>(groupChatKeys.messages(wsId, selected.id)) ?? [];
    return chatAskPage(selected, chatDisplayTitle(selected, userId, getActorName), messages, visibleMessageIds(), getActorName);
  };
  const launcher = useAskAILauncher(askPage);
  const openNote = useCallback(
    (note: KnowledgeNoteTab) => {
      patchNoteTabs((state) => openKnowledgeNote(state, note));
      setPanelOpen(true);
      if (!isMobile || view !== "chats") return;
      const chatId = navigation.searchParams.get("chat");
      if (chatId && navigation.searchParams.get("view") !== "settings") {
        navigation.push(paths.imChatSettings(chatId));
      }
    },
    [isMobile, navigation, patchNoteTabs, paths, view],
  );

  const rail = <ImRail active={view} readingChatId={view === "chats" ? selected?.id : null} />;
  const contactList = (className?: string) => (
    <ContactList
      people={directory.people}
      agents={directory.agents}
      chats={chats}
      userId={userId}
      selectedKey={memberChat ? null : contact ? contactKey : null}
      selectedChatId={memberChat?.id ?? null}
      onSelect={selectContact}
      onOpenChat={openMemberChat}
      onCreateAgent={() =>
        isMobile ? navigation.push(paths.memberNewAgent()) : useModalStore.getState().open("create-agent")
      }
      onOpenSearch={() => navigation.push(paths.memberSearch())}
      className={className}
    />
  );

  const dialogs = (
    <>
      <NewChatDialog
        wsId={wsId}
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onCreated={(chat) => select(chat.id)}
      />
      <ImSearchDialog
        {...launcher.dialog}
        onOpenChat={view === "chats" ? select : undefined}
        onOpenContact={view === "contacts" ? selectContact : undefined}
      />
    </>
  );

  if (isMobile) {
    const settingsOpen = navigation.searchParams.get("view") === "settings";
    const searchOpen = navigation.searchParams.get("view") === "search";
    if (searchOpen && !requestedId && !contactTarget && !memberChatId) {
      const backHref = view === "contacts" ? paths.member() : paths.im();
      return (
        <MobileLevel
          title={t(($) => $.search.title)}
          backHref={backHref}
          backLabel={view === "contacts" ? t(($) => $.contacts.back) : t(($) => $.thread.back)}
        >
          <ImSearchDialog
            presentation="page"
            open
            page={null}
            selection={null}
            onOpenChange={() => {}}
            onClearSelection={() => {}}
            onOpenChat={(id) => navigation.replace(view === "chats" ? paths.imChat(id) : paths.memberChat(id))}
            onOpenContact={(entry) => navigation.replace(paths.memberContact(entry.type, entry.id))}
            onOpenNote={(path) => navigation.replace(paths.knowledgeFile(path))}
          />
        </MobileLevel>
      );
    }

    const pageView = navigation.searchParams.get("view");
    if (view === "chats" && pageView === "new" && !requestedId) {
      return (
        <MobileLevel title={t(($) => $.new_chat.title)} backHref={paths.im()} backLabel={t(($) => $.thread.back)}>
          <NewChatDialog
            presentation="page"
            wsId={wsId}
            open
            onOpenChange={() => {}}
            onCreated={(chat) => navigation.replace(paths.imChat(chat.id))}
          />
        </MobileLevel>
      );
    }
    if (view === "contacts" && pageView === "new-agent" && !contactTarget && !memberChatId) {
      return (
        <MobileLevel
          title={tAgents(($) => $.create_dialog.title_create)}
          backHref={paths.member()}
          backLabel={t(($) => $.contacts.back)}
        >
          <CreateAgentModal
            presentation="page"
            onClose={() => navigation.replace(paths.member())}
            onCreated={(agent) => navigation.replace(paths.memberContact("agent", agent.id))}
          />
        </MobileLevel>
      );
    }

    if (view === "contacts") {
      let contactLevel: React.ReactNode;
      if (contactTarget && memberChat) {
        contactLevel = (
          <MobileContactDetail
            contact={contactTarget}
            backHref={paths.memberChat(memberChat.id)}
            backLabel={t(($) => $.panel.back_to_info)}
          />
        );
      } else if (contactTarget) {
        contactLevel = (
          <MobileContactDetail contact={contactTarget} backHref={paths.member()} backLabel={t(($) => $.contacts.back)} />
        );
      } else if (memberChatId && !memberChat) {
        contactLevel = (
          <MobileLevel title="" backHref={paths.member()} backLabel={t(($) => $.contacts.back)}>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <MessagesSquare className="size-8" />
              {!isLoading && <p className="text-body">{t(($) => $.thread.not_found)}</p>}
            </div>
          </MobileLevel>
        );
      } else if (memberChat) {
        contactLevel = (
          <MobileLevel title={memberChat.title} backHref={paths.member()} backLabel={t(($) => $.contacts.back)}>
            <div className="shrink-0 border-b px-4 py-3">
              <Button nativeButton={false} render={<AppLink href={paths.imChat(memberChat.id)} />}>
                {t(($) => $.panel.open_chat)}
              </Button>
            </div>
            <ChatDetailsPanel
              wsId={wsId}
              chat={memberChat}
              userId={userId}
              variant="page"
              onOpenMember={(m) => navigation.push(paths.memberChatContact(memberChat.id, m.member_type, m.member_id))}
            />
          </MobileLevel>
        );
      } else {
        contactLevel = (
          <MobileTabScreen active="settings">
            <div className="flex min-w-0 flex-1 flex-col">
              <MeSectionTabs active="contacts" />
              {contactList("min-w-0 flex-1 border-r-0")}
            </div>
          </MobileTabScreen>
        );
      }
      return (
        <KnowledgeNotesProvider onOpen={openNote}>
          {contactLevel}
          {dialogs}
        </KnowledgeNotesProvider>
      );
    }

    let level: React.ReactNode;
    if (!requestedId) {
      level = (
        <MobileTabScreen active="chats">
          <ChatSidebar
            chats={chats}
            isLoading={isLoading}
            isError={isError}
            selectedId={null}
            userId={userId}
            onSelect={select}
            onNewChat={() => navigation.push(paths.imNewChat())}
            onSetPinned={setChatPinned}
            onOpenSearch={() => navigation.push(paths.imSearch())}
            iosMenu
            className="min-w-0 flex-1 border-r-0"
          />
        </MobileTabScreen>
      );
    } else if (!requested) {
      level = (
        <MobileLevel title="" backHref={paths.im()} backLabel={t(($) => $.thread.back)}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <MessagesSquare className="size-8" />
            {!isLoading && <p className="text-body">{t(($) => $.thread.not_found)}</p>}
          </div>
        </MobileLevel>
      );
    } else if (contactTarget) {
      level = settingsOpen ? (
        <MobileContactDetail
          contact={contactTarget}
          backHref={paths.imChatSettings(requested.id)}
          backLabel={t(($) => $.panel.back_to_settings)}
        />
      ) : (
        <MobileContactDetail contact={contactTarget} backHref={paths.imChat(requested.id)} backLabel={t(($) => $.panel.back)} />
      );
    } else if (navigation.searchParams.get("view") === "history") {
      level = (
        <ChatHistoryRoute
          wsId={wsId}
          chatId={requested.id}
          messageId={navigation.searchParams.get("message") ?? ""}
          nest={navigation.searchParams.get("nest")}
        />
      );
    } else if (navigation.searchParams.get("view") === "progress") {
      level = (
        <ChatProgressRoute chatId={requested.id} taskId={navigation.searchParams.get("task") ?? ""} />
      );
    } else if (settingsOpen) {
      level = (
        <MobileLevel title={t(($) => $.thread.settings)} backHref={paths.imChat(requested.id)} backLabel={t(($) => $.panel.back)}>
          <ChatSidePanel
            wsId={wsId}
            chat={requested}
            userId={userId}
            notes={noteTabs.notes}
            activePath={noteTabs.activePath}
            onSelectDetails={() => patchNoteTabs((state) => ({ ...state, activePath: null }))}
            onSelectNote={(path) => patchNoteTabs((state) => ({ ...state, activePath: path }))}
            onCloseNote={(path) => patchNoteTabs((state) => closeKnowledgeNote(state, path))}
            onReturnToComposer={() => navigation.push(paths.imChat(requested.id))}
            chrome="page"
            onOpenMember={(m) => navigation.push(paths.imChatSettingsContact(requested.id, m.member_type, m.member_id))}
          />
        </MobileLevel>
      );
    } else {
      const peer = directChatPeer(requested, userId);
      level = (
        <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
          <ChatThread
            key={requested.id}
            wsId={wsId}
            chat={requested}
            userId={userId}
            panelOpen={false}
            onTogglePanel={() => {}}
            onAskAI={launcher.show}
            focusNote={focusedNote}
            mobileNav={{
              backHref: paths.im(),
              settingsHref: peer
                ? paths.imChatContact(requested.id, peer.member_type, peer.member_id)
                : paths.imChatSettings(requested.id),
              onOpenProfile: (type, id) => navigation.push(paths.imChatContact(requested.id, type, id)),
              onOpenHistory: (messageId) => navigation.push(paths.imChatHistory(requested.id, messageId)),
              onOpenProgress: (taskId) => navigation.push(paths.imChatProgress(requested.id, taskId)),
            }}
          />
        </div>
      );
    }

    return (
      <KnowledgeNotesProvider onOpen={openNote}>
        <DocExcerptInsertProvider>
          <DocExcerptRevealProvider onOpen={openNote}>
            {level}
            {dialogs}
          </DocExcerptRevealProvider>
        </DocExcerptInsertProvider>
      </KnowledgeNotesProvider>
    );
  }

  return (
    <KnowledgeNotesProvider onOpen={openNote}>
      <DocExcerptInsertProvider>
      <DocExcerptRevealProvider onOpen={openNote}>
      <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
        {rail}
        {view === "contacts" ? (
          contactList()
        ) : (
          <ChatSidebar
            chats={chats}
            isLoading={isLoading}
            isError={isError}
            selectedId={selected?.id ?? null}
            userId={userId}
            onSelect={select}
            onNewChat={() => setNewChatOpen(true)}
            onSetPinned={setChatPinned}
            onOpenSearch={() => navigation.push(paths.imSearch())}
          />
        )}

        <div className="relative flex min-w-0 flex-1">
          {view === "contacts" ? (
            contact && !memberChat ? (
              <ContactCard
                key={contactKey}
                wsId={wsId}
                entry={contact}
                chats={chats}
                userId={userId}
                onOpenChat={openMemberChat}
                onAskAI={() => launcher.show()}
              />
            ) : memberChat ? (
              <div className="flex min-w-0 flex-1 flex-col">
                <header className="relative flex h-14 shrink-0 items-center justify-end border-b px-5">
                  <div className="absolute inset-0">
                    <DragStrip />
                  </div>
                  <Button
                    nativeButton={false}
                    className="relative"
                    style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
                    render={<AppLink href={paths.imChat(memberChat.id)} />}
                  >
                    {t(($) => $.panel.open_chat)}
                  </Button>
                </header>
                <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
                  <ChatDetailsPanel wsId={wsId} chat={memberChat} userId={userId} variant="page" />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col">
                <DragStrip />
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <UsersRound className="size-8" />
                  <p className="text-body">{t(($) => $.contacts.select)}</p>
                </div>
              </div>
            )
          ) : selected ? (
            <>
              <ChatThread
                key={selected.id}
                wsId={wsId}
                chat={selected}
                userId={userId}
                panelOpen={panelOpen}
                onTogglePanel={() => setPanelOpen((v) => !v)}
                onAskAI={launcher.show}
                focusNote={focusedNote}
              />
              {panelOpen && (
                <ChatSidePanel
                  wsId={wsId}
                  chat={selected}
                  userId={userId}
                  notes={noteTabs.notes}
                  activePath={noteTabs.activePath}
                  onSelectDetails={() => patchNoteTabs((state) => ({ ...state, activePath: null }))}
                  onSelectNote={(path) => patchNoteTabs((state) => ({ ...state, activePath: path }))}
                  onCloseNote={(path) => patchNoteTabs((state) => closeKnowledgeNote(state, path))}
                />
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col">
              <DragStrip />
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                <MessagesSquare className="size-8" />
                <p className="text-body">{isLoading ? "" : t(($) => $.thread.select)}</p>
                {!isLoading && chats.length === 0 && (
                  <Button onClick={() => setNewChatOpen(true)}>{t(($) => $.sidebar.new_chat)}</Button>
                )}
              </div>
            </div>
          )}
        </div>

        {dialogs}
      </div>
      </DocExcerptRevealProvider>
      </DocExcerptInsertProvider>
    </KnowledgeNotesProvider>
  );
}
