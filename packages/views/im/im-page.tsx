"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, UsersRound } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useModalStore } from "@multica/core/modals";
import { useWorkspacePaths } from "@multica/core/paths";
import { directChatPeer, groupChatListOptions, useGroupChatRealtime } from "@multica/core/group-chats";
import type { GroupChat } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { ChatDetailsPanel } from "./chat-details-panel";
import { ChatSidebar } from "./chat-sidebar";
import { ChatThread } from "./chat-thread";
import { ContactCard } from "./contact-card";
import { ContactList } from "./contact-list";
import { ImRail, type ImView } from "./im-rail";
import { MobileContactDetail, MobileLevel, MobileTabScreen, parseContactParam } from "./mobile-shell";
import { sortChatsByActivity } from "./im-utils";
import { NewChatDialog } from "./new-chat-dialog";
import { entryKey, useChatDirectory, type DirectoryEntry } from "./use-chat-directory";

const EMPTY_CHATS: GroupChat[] = [];

/**
 * Full-window group chat surface. Deliberately outside the dashboard shell:
 * it owns its own sidebar, thread and details columns. The rail section is
 * route-driven: chats (`/im`) and contacts (`/member`). On phones each
 * section is a bottom tab whose list is the root, and the columns become
 * route-driven levels: thread (`?chat=`), settings (`&view=settings`), and a
 * profile (`&contact=type:id`) opened from either; on `/member` a profile is
 * the only level.
 */
export function ImPage({ view = "chats" }: { view?: ImView }) {
  const { t } = useT("im");
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const isMobile = useIsMobile();
  const { data = EMPTY_CHATS, isLoading, isError } = useQuery(groupChatListOptions(wsId));
  const [panelOpen, setPanelOpen] = useState(true);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [contactKey, setContactKey] = useState<string | null>(null);
  const directory = useChatDirectory(wsId);

  useGroupChatRealtime(wsId);

  const chats = useMemo(() => sortChatsByActivity(data), [data]);
  const requestedId = view === "chats" ? navigation.searchParams.get("chat") : null;
  const requested = chats.find((c) => c.id === requestedId) ?? null;
  const selected = requested ?? (requestedId || isMobile ? null : chats[0] ?? null);

  const select = (chatId: string) =>
    isMobile ? navigation.push(paths.imChat(chatId)) : navigation.replace(paths.imChat(chatId));

  const openChat = (chatId: string) => navigation.push(paths.imChat(chatId));

  const contact = contactKey ? directory.byKey.get(contactKey) ?? null : null;
  const selectContact = (entry: DirectoryEntry) => {
    if (isMobile) navigation.push(paths.memberContact(entry.type, entry.id));
    else setContactKey(entryKey(entry.type, entry.id));
  };

  const rail = <ImRail active={view} />;
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

  const newChatDialog = (
    <NewChatDialog
      wsId={wsId}
      open={newChatOpen}
      onOpenChange={setNewChatOpen}
      onCreated={(chat) => select(chat.id)}
    />
  );

  if (isMobile) {
    const settingsOpen = navigation.searchParams.get("view") === "settings";
    const contactTarget = parseContactParam(navigation.searchParams.get("contact"));

    if (view === "contacts") {
      return contactTarget ? (
        <MobileContactDetail contact={contactTarget} backHref={paths.member()} backLabel={t(($) => $.contacts.back)} />
      ) : (
        <MobileTabScreen active="contacts">{contactList("min-w-0 flex-1 border-r-0")}</MobileTabScreen>
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
        {newChatDialog}
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
          userId={userId}
          onSelect={select}
          onNewChat={() => setNewChatOpen(true)}
        />
      )}

      <div className="relative flex min-w-0 flex-1">
        {view === "contacts" ? (
          contact ? (
            <ContactCard key={contactKey} wsId={wsId} entry={contact} chats={chats} userId={userId} onOpenChat={openChat} />
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

      {newChatDialog}
    </div>
  );
}
