"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, MessagesSquare, UsersRound } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { groupChatListOptions, useGroupChatRealtime } from "@multica/core/group-chats";
import type { GroupChat } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { AppLink, useNavigation } from "../navigation";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { ChatDetailsPanel } from "./chat-details-panel";
import { ChatSidebar } from "./chat-sidebar";
import { ChatThread } from "./chat-thread";
import { ContactCard } from "./contact-card";
import { ContactList } from "./contact-list";
import { ImRail, type ImView } from "./im-rail";
import { sortChatsByActivity } from "./im-utils";
import { NewChatDialog } from "./new-chat-dialog";
import { entryKey, useChatDirectory, type DirectoryEntry } from "./use-chat-directory";

const EMPTY_CHATS: GroupChat[] = [];

/**
 * Full-window group chat surface. Deliberately outside the dashboard shell:
 * it owns its own sidebar, thread and details columns. The rail section is
 * route-driven: chats (`/im`) and contacts (`/member`). On mobile the chat
 * columns become route-driven levels: list (`/im`), thread (`?chat=`),
 * settings (`?chat=&view=settings`).
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
  const selectContact = (entry: DirectoryEntry) =>
    isMobile
      ? navigation.push(entry.type === "agent" ? paths.agentDetail(entry.id) : paths.memberDetail(entry.id))
      : setContactKey(entryKey(entry.type, entry.id));

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
    return (
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
        {!requestedId ? (
          <div className="flex min-h-0 flex-1">
            {rail}
            {view === "contacts" ? (
              contactList("min-w-0 flex-1 border-r-0")
            ) : (
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
            )}
          </div>
        ) : !requested ? (
          <MobileLevel title="" backHref={paths.im()} backLabel={t(($) => $.thread.back)}>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <MessagesSquare className="size-8" />
              {!isLoading && <p className="text-body">{t(($) => $.thread.not_found)}</p>}
            </div>
          </MobileLevel>
        ) : settingsOpen ? (
          <MobileLevel
            title={t(($) => $.thread.settings)}
            backHref={paths.imChat(requested.id)}
            backLabel={t(($) => $.panel.back)}
          >
            <ChatDetailsPanel wsId={wsId} chat={requested} userId={userId} variant="page" />
          </MobileLevel>
        ) : (
          <ChatThread
            key={requested.id}
            wsId={wsId}
            chat={requested}
            userId={userId}
            panelOpen={false}
            onTogglePanel={() => {}}
            mobileNav={{ backHref: paths.im(), settingsHref: paths.imChatSettings(requested.id) }}
          />
        )}
        {newChatDialog}
      </div>
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
            <ContactCard key={contactKey} entry={contact} chats={chats} userId={userId} onOpenChat={openChat} />
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

function MobileLevel({
  title,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<AppLink href={backHref} />} aria-label={backLabel}>
          <ChevronLeft />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-body-lg font-semibold">{title}</h1>
      </header>
      {children}
    </section>
  );
}
