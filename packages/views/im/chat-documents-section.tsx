"use client";

import { useId, useMemo, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { docsKeys } from "@multica/core/docs";
import { groupChatMessagesOptions } from "@multica/core/group-chats";
import { paths, useWorkspaceSlug } from "@multica/core/paths";
import { docPathToOpen, useDocOpenPath } from "./doc-open-path";
import type { Comment, GroupChat } from "@multica/core/types";
import { useTimeAgo, useT } from "../i18n";
import { AppLink } from "../navigation";
import { useOpenKnowledgeNote } from "./knowledge-note-tabs";
import { CHAT_DOCUMENT_ROW_PX, chatDocumentListMaxPx, documentsInChat, type ChatDocument } from "./chat-documents";

const EMPTY_MESSAGES: Comment[] = [];

/** Documents whose cards appeared in this group or direct chat. */
export function ChatDocumentsSection({ wsId, chat }: { wsId: string; chat: GroupChat }) {
  const { t } = useT("im");
  const titleId = useId();
  const { data = EMPTY_MESSAGES } = useQuery(groupChatMessagesOptions(wsId, chat.id));
  const documents = useMemo(() => documentsInChat(data), [data]);
  if (documents.length === 0) return null;

  const title = chat.is_direct ? t(($) => $.panel.documents_direct) : t(($) => $.panel.documents);
  return (
    <section className="flex flex-col gap-1.5">
      <h2 id={titleId} className="px-1 text-micro font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <ul
        aria-labelledby={titleId}
        className="overflow-y-auto overscroll-contain rounded-xl border bg-background"
        style={{ maxHeight: chatDocumentListMaxPx() }}
      >
        {documents.map((doc) => (
          <li
            key={doc.note.path}
            className="border-b border-border last:border-b-0"
            style={{ height: CHAT_DOCUMENT_ROW_PX }}
          >
            <ChatDocumentRow doc={doc} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const ROW =
  "flex h-full w-full items-start gap-3 overflow-hidden px-3 py-1.5 text-left hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none";

function ChatDocumentRow({ doc }: { doc: ChatDocument }) {
  const timeAgo = useTimeAgo();
  const qc = useQueryClient();
  const slug = useWorkspaceSlug();
  const openNote = useOpenKnowledgeNote();
  const openPath = useDocOpenPath(doc.note.path);
  const when = timeAgo(doc.appearedAt);
  const href = slug ? paths.workspace(slug).knowledgeFile(openPath) : null;

  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (!openNote || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void (async () => {
      const path = await docPathToOpen(qc, doc.note.path);
      qc.removeQueries({ queryKey: docsKeys.file(path), exact: true });
      if (path !== doc.note.path) qc.removeQueries({ queryKey: docsKeys.file(doc.note.path), exact: true });
      openNote({ path, name: doc.note.name });
    })();
  };

  const body = (
    <>
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block h-5 truncate text-body font-medium">{doc.note.name}</span>
        <span className="block h-4 truncate text-caption text-muted-foreground">{doc.note.summary}</span>
        <span className="block h-4 truncate text-caption text-muted-foreground">{openPath}</span>
      </span>
      <time dateTime={doc.appearedAt} className="shrink-0 pt-0.5 text-caption text-muted-foreground">
        {when}
      </time>
    </>
  );

  if (!href) {
    return (
      <button type="button" onClick={open} className={ROW}>
        {body}
      </button>
    );
  }
  return (
    <AppLink href={href} onClick={open} className={ROW}>
      {body}
    </AppLink>
  );
}
