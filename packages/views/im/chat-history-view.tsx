"use client";

import { useQuery } from "@tanstack/react-query";
import { groupChatMessagesOptions } from "@multica/core/group-chats";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { historyAt, parseChatHistory, parseHistoryNest } from "./chat-history";
import { ChatHistoryTranscript, useHistoryTitle } from "./chat-history-card";
import { MobileLevel } from "./mobile-shell";

export interface ChatHistoryHrefs {
  chat: (chatId: string) => string;
  history: (chatId: string, messageId: string, nest?: string) => string;
}

/**
 * Phone level for one forwarded history card. Nested cards push another level
 * instead of opening a dialog. `hrefs` keeps the level on the page that
 * opened it, so a reminder does not jump to `/im`.
 */
export function ChatHistoryRoute({ wsId, chatId, messageId, nest, hrefs }: {
  wsId: string;
  chatId: string;
  messageId: string;
  nest: string | null;
  hrefs: ChatHistoryHrefs;
}) {
  const { t } = useT("im");
  const navigation = useNavigation();
  const messages = useQuery(groupChatMessagesOptions(wsId, chatId));
  const root = parseChatHistory(messages.data?.find((message) => message.id === messageId)?.content ?? "");
  const indexes = parseHistoryNest(nest);
  const record = root ? historyAt(root, indexes) : null;
  const title = useHistoryTitle(record);
  const backHref = indexes.length === 0
    ? hrefs.chat(chatId)
    : hrefs.history(chatId, messageId, indexes.length > 1 ? indexes.slice(0, -1).join(".") : undefined);

  return (
    <MobileLevel
      title={record ? title : ""}
      backHref={backHref}
      backLabel={indexes.length === 0 ? t(($) => $.panel.back) : t(($) => $.thread.history_footer)}
    >
      {record ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <ChatHistoryTranscript
            record={record}
            onOpenNested={(index) =>
              navigation.push(hrefs.history(chatId, messageId, [...indexes, index].join(".")))
            }
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {!messages.isPending && <p className="text-body">{t(($) => $.thread.not_found)}</p>}
        </div>
      )}
    </MobileLevel>
  );
}
