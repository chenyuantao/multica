"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, PanelLeft } from "lucide-react";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { groupChatListOptions, useGroupChatRealtime } from "@multica/core/group-chats";
import type { GroupChat } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { ChatDetailsPanel } from "./chat-details-panel";
import { ChatSidebar } from "./chat-sidebar";
import { ChatThread } from "./chat-thread";
import { sortChatsByActivity } from "./im-utils";
import { NewChatDialog } from "./new-chat-dialog";

const EMPTY_CHATS: GroupChat[] = [];

/**
 * Full-window group chat surface. Deliberately outside the dashboard shell:
 * it owns its own sidebar, thread and details columns.
 */
export function ImPage() {
  const { t } = useT("im");
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const { data = EMPTY_CHATS, isLoading, isError } = useQuery(groupChatListOptions(wsId));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [newChatOpen, setNewChatOpen] = useState(false);

  useGroupChatRealtime(wsId);

  const chats = useMemo(() => sortChatsByActivity(data), [data]);
  const requestedId = navigation.searchParams.get("chat");
  const selected = chats.find((c) => c.id === requestedId) ?? (requestedId ? null : chats[0] ?? null);

  const select = (chatId: string) => navigation.replace(paths.imChat(chatId));

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <ChatSidebar
          chats={chats}
          isLoading={isLoading}
          isError={isError}
          selectedId={selected?.id ?? null}
          userId={userId}
          onSelect={select}
          onNewChat={() => setNewChatOpen(true)}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}

      <div className="relative flex min-w-0 flex-1">
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-3 left-3 z-10"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={() => setSidebarOpen(true)}
            aria-label={t(($) => $.sidebar.toggle)}
          >
            <PanelLeft />
          </Button>
        )}
        {selected ? (
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

      <NewChatDialog
        wsId={wsId}
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onCreated={(chat) => select(chat.id)}
      />
    </div>
  );
}
