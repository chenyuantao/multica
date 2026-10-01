"use client";

import { useMemo, useState, type CSSProperties } from "react";
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
import { ChatDetailsPanel } from "./chat-details-panel";
import { ChatSidebar } from "./chat-sidebar";
import { ChatThread } from "./chat-thread";
import { ContactCard } from "./contact-card";
import { ContactList } from "./contact-list";
import { ImRail, type ImView } from "./im-rail";
import { ImSearchDialog } from "./im-search-dialog";
import { MobileContactDetail, MobileLevel, MobileTabScreen, parseContactParam } from "./mobile-shell";
import { chatDisplayTitle, sortChats } from "./im-utils";
import { NewChatDialog } from "./new-chat-dialog";
import { useAskAILauncher } from "./use-ask-ai-launcher";
import { entryKey, useChatDirectory, type DirectoryEntry } from "./use-chat-directory";

const EMPTY_CHATS: GroupChat[] = [];

/**
 * Full-window group chat surface. Deliberately outside the dashboard shell:
 * it owns its own sidebar, thread and details columns. The rail section is
 * route-driven: chats (`/im`) and contacts (`/member`). On phones each
 * section is a bottom tab whose list is the root, and the columns become
 * route-driven levels: a group's details (`?chat=&view=info`) before its
 * thread (`?chat=`), settings (`&view=settings`), and a profile
 * (`&contact=type:id`) opened from either; on `/member` a profile is
 * the only level. A direct chat still opens its thread.
 */
export function ImPage({ view = "chats" }: { view?: ImView }) {
  const { t } = useT("im");
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { getActorName } = useActorName();
  const { data = EMPTY_CHATS, isLoading, isError } = useQuery(groupChatListOptions(wsId));
  const [panelOpen, setPanelOpen] = useState(true);
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
  const viewParam = view === "chats" ? navigation.searchParams.get("view") : null;
  const selectedIsGroup = !!selected && !directChatPeer(selected, userId);
  // A group opens onto its details. The thread is the explicit conversation
  // URL (`?chat=` without `view=info`), including deep links and "message".
  // With no chat in the URL, desktop still previews the first group instead
  // of dropping into its messages.
  const showGroupInfo = selectedIsGroup && (viewParam === "info" || (!isMobile && !requestedId));

  const go = (href: string) => (isMobile ? navigation.push(href) : navigation.replace(href));
  const chatHref = (chat: GroupChat | undefined, chatId: string) =>
    chat && !directChatPeer(chat, userId) ? paths.imChatInfo(chatId) : paths.imChat(chatId);
  const select = (chatId: string) => go(chatHref(chats.find((c) => c.id === chatId), chatId));

  const openChat = (chatId: string) => navigation.push(paths.imChat(chatId));

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

  const rail = (
    <ImRail active={view} readingChatId={view === "chats" && !showGroupInfo ? selected?.id ?? null : null} />
  );
  const contactList = (className?: string) => (
    <ContactList
      people={directory.people}
      agents={directory.agents}
      chats={chats}
      userId={userId}
      selectedKey={contact ? contactKey : null}
      onSelect={selectContact}
      onOpenChat={openChat}
      onCreateAgent={() => useModalStore.getState().open("create-agent")}
      className={className}
    />
  );

  const dialogs = (
    <>
      <NewChatDialog
        wsId={wsId}
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onCreated={(chat) => go(chatHref(chat, chat.id))}
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

    if (view === "contacts") {
      return (
        <>
          {contactTarget ? (
            <MobileContactDetail contact={contactTarget} backHref={paths.member()} backLabel={t(($) => $.contacts.back)} />
          ) : (
            <MobileTabScreen active="contacts">{contactList("min-w-0 flex-1 border-r-0")}</MobileTabScreen>
          )}
          {dialogs}
        </>
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
            onNewChat={() => setNewChatOpen(true)}
            onSetPinned={setChatPinned}
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
      ) : viewParam === "info" ? (
        <MobileContactDetail
          contact={contactTarget}
          backHref={paths.imChatInfo(requested.id)}
          backLabel={t(($) => $.panel.back_to_info)}
        />
      ) : (
        <MobileContactDetail contact={contactTarget} backHref={paths.imChat(requested.id)} backLabel={t(($) => $.panel.back)} />
      );
    } else if (settingsOpen) {
      level = (
        <MobileLevel title={t(($) => $.thread.settings)} backHref={paths.imChat(requested.id)} backLabel={t(($) => $.panel.back)}>
          <ChatDetailsPanel
            wsId={wsId}
            chat={requested}
            userId={userId}
            variant="page"
            onOpenMember={(m) => navigation.push(paths.imChatSettingsContact(requested.id, m.member_type, m.member_id))}
          />
        </MobileLevel>
      );
    } else if (showGroupInfo) {
      level = (
        <MobileLevel
          title={chatDisplayTitle(requested, userId, getActorName)}
          backHref={paths.im()}
          backLabel={t(($) => $.thread.back)}
        >
          <div className="shrink-0 border-b px-4 py-3">
            <Button nativeButton={false} render={<AppLink href={paths.imChat(requested.id)} />}>
              {t(($) => $.panel.open_chat)}
            </Button>
          </div>
          <ChatDetailsPanel
            wsId={wsId}
            chat={requested}
            userId={userId}
            variant="page"
            onOpenMember={(m) => navigation.push(paths.imChatInfoContact(requested.id, m.member_type, m.member_id))}
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
            mobileNav={{
              backHref: paths.im(),
              settingsHref: peer
                ? paths.imChatContact(requested.id, peer.member_type, peer.member_id)
                : paths.imChatSettings(requested.id),
              onOpenProfile: (type, id) => navigation.push(paths.imChatContact(requested.id, type, id)),
            }}
          />
        </div>
      );
    }

    return (
      <>
        {level}
        {dialogs}
      </>
    );
  }

  return (
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
          readingId={showGroupInfo ? null : selected?.id ?? null}
          userId={userId}
          onSelect={select}
          onNewChat={() => setNewChatOpen(true)}
          onSetPinned={setChatPinned}
        />
      )}

      <div className="relative flex min-w-0 flex-1">
        {view === "contacts" ? (
          contact ? (
            <ContactCard
              key={contactKey}
              wsId={wsId}
              entry={contact}
              chats={chats}
              userId={userId}
              onOpenChat={openChat}
              onAskAI={() => launcher.show()}
            />
          ) : (
            <div className="flex flex-1 flex-col">
              <DragStrip />
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                <UsersRound className="size-8" />
                <p className="text-body">{t(($) => $.contacts.select)}</p>
              </div>
            </div>
          )
        ) : showGroupInfo && selected ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="relative flex h-14 shrink-0 items-center justify-end border-b px-5">
              <div className="absolute inset-0">
                <DragStrip />
              </div>
              <Button
                nativeButton={false}
                className="relative"
                style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
                render={<AppLink href={paths.imChat(selected.id)} />}
              >
                {t(($) => $.panel.open_chat)}
              </Button>
            </header>
            <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
              <ChatDetailsPanel wsId={wsId} chat={selected} userId={userId} variant="page" />
            </div>
          </div>
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
            />
            {panelOpen && <ChatDetailsPanel wsId={wsId} chat={selected} userId={userId} />}
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
  );
}
