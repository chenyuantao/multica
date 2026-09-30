"use client";

import type { GroupChat } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { Button } from "@multica/ui/components/ui/button";
import { ActorAvatar } from "../common/actor-avatar";
import { AppLink } from "../navigation";
import { useT } from "../i18n";
import { useOpenAgentDetail } from "../modals/agent-detail";
import { DragStrip } from "../platform";
import { ChatAvatar } from "./chat-sidebar";
import type { DirectoryEntry } from "./use-chat-directory";

interface ContactCardProps {
  entry: DirectoryEntry;
  chats: GroupChat[];
  userId: string;
  onOpenChat: (chatId: string) => void;
}

export function ContactCard({ entry, chats, userId, onOpenChat }: ContactCardProps) {
  const { t } = useT("im");
  const paths = useWorkspacePaths();
  const openAgentDetail = useOpenAgentDetail();
  const shared = chats.filter((c) => c.members.some((m) => m.member_type === entry.type && m.member_id === entry.id));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <DragStrip />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 pt-8 pb-10">
          <div className="flex items-center gap-4">
            <ActorAvatar actorType={entry.type} actorId={entry.id} size="2xl" profileLink={false} showStatusDot />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-title font-semibold">{entry.name}</h1>
              <p className="truncate text-body text-muted-foreground">
                {entry.type === "agent" ? t(($) => $.contacts.agent) : t(($) => $.contacts.person)}
                {entry.type === "member" && entry.id === userId && ` · ${t(($) => $.contacts.you)}`}
              </p>
            </div>
          </div>

          {entry.detail && <p className="text-body break-words whitespace-pre-wrap text-muted-foreground">{entry.detail}</p>}

          <div>
            {entry.type === "agent" ? (
              <Button variant="outline" onClick={() => openAgentDetail(entry.id)}>
                {t(($) => $.contacts.view_profile)}
              </Button>
            ) : (
              <Button variant="outline" nativeButton={false} render={<AppLink href={paths.memberDetail(entry.id)} />}>
                {t(($) => $.contacts.view_profile)}
              </Button>
            )}
          </div>

          {shared.length > 0 && (
            <section className="flex flex-col gap-1 border-t pt-5">
              <h2 className="pb-1 text-label font-medium text-muted-foreground">{t(($) => $.contacts.shared_chats)}</h2>
              <ul className="flex flex-col">
                {shared.map((chat) => (
                  <li key={chat.id}>
                    <button
                      type="button"
                      onClick={() => onOpenChat(chat.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <ChatAvatar chat={chat} userId={userId} />
                      <span className="min-w-0 flex-1 truncate text-body">{chat.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
