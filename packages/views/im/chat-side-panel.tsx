"use client";

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { X, Loader2 } from "lucide-react";
import { directChatPeer } from "@multica/core/group-chats";
import { useActorName } from "@multica/core/workspace/hooks";
import type { GroupChat, GroupChatMember } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { ChatDetailsPanel } from "./chat-details-panel";
import { DocumentVoiceAsk } from "./document-voice-ask";
import { useInsertDocExcerpt } from "./doc-excerpt-insert";
import { retainOpenNotes, type KnowledgeNoteTab } from "./knowledge-note-tabs";
import { ColumnResizeHandle } from "./resizable-column";
import { useDetailsColumnWidth } from "./use-details-column-width";

const KnowledgeDocument = lazy(() =>
  import("./knowledge-document").then((m) => ({ default: m.KnowledgeDocument })),
);

interface ChatSidePanelProps {
  wsId: string;
  chat: GroupChat;
  userId: string;
  notes: KnowledgeNoteTab[];
  activePath: string | null;
  onSelectDetails: () => void;
  onSelectNote: (path: string) => void;
  onCloseNote: (path: string) => void;
  /** `page` fills the screen; `aside` is the resizable column beside the thread. */
  chrome?: "aside" | "page";
  onOpenMember?: (member: GroupChatMember) => void;
  /** The composer is on another screen, so the passage waited. Mobile uses this to show the chat. */
  onReturnToComposer?: () => void;
}

/**
 * Chat details, plus one tab per knowledge note opened from a document card.
 * The details tab stays first and cannot close. The tab bar appears only
 * once a note is open, and scrolls sideways when the titles do not fit.
 *
 * Switching tabs hides the previous pane instead of unmounting it, so the
 * editor's text, cursor, and scroll stay in memory. Closing a note, or the
 * last note of a chat, is what drops that tree.
 */
export function ChatSidePanel({
  wsId,
  chat,
  userId,
  notes,
  activePath,
  onSelectDetails,
  onSelectNote,
  onCloseNote,
  chrome = "aside",
  onOpenMember,
  onReturnToComposer,
}: ChatSidePanelProps) {
  const { t } = useT("im");
  const insertExcerpt = useInsertDocExcerpt();
  const { getActorName } = useActorName();
  const columnRef = useRef<HTMLDivElement>(null);
  const { width, commit, options, bounded } = useDetailsColumnWidth(columnRef);
  const expandedFor = useRef<string | null>(null);
  // Opening a document uses the widest allowed column. A later drag stays until the next open.
  useEffect(() => {
    if (chrome === "page" || !activePath) {
      expandedFor.current = null;
      return;
    }
    if (!bounded) return;
    if (expandedFor.current === activePath) return;
    expandedFor.current = activePath;
    commit(options.max);
  }, [activePath, bounded, chrome, commit, options.max]);
  const noteKey = `${chat.id}:${notes.map((note) => `${note.path}\n${note.name}`).join("\0")}`;
  const [appliedNoteKey, setAppliedNoteKey] = useState(noteKey);
  const [retained, setRetained] = useState<Record<string, readonly KnowledgeNoteTab[]>>(() =>
    notes.length > 0 ? { [chat.id]: notes } : {},
  );
  if (appliedNoteKey !== noteKey) {
    setAppliedNoteKey(noteKey);
    setRetained((prev) => retainOpenNotes(prev, chat.id, notes));
  }
  const active = notes.find((note) => note.path === activePath) ?? null;
  const peer = directChatPeer(chat, userId);
  const detailsLabel = peer ? getActorName(peer.member_type, peer.member_id) : chat.title || t(($) => $.panel.info);

  const body = (
    <>
      {notes.length > 0 && (
        <div
          role="tablist"
          aria-label={t(($) => $.panel.tabs)}
          className="flex h-10 min-w-0 shrink-0 overflow-x-auto border-b bg-muted/40 [-webkit-overflow-scrolling:touch]"
        >
          <PanelTab selected={active == null} onClick={onSelectDetails}>
            {detailsLabel}
          </PanelTab>
          {notes.map((note) => (
            <div key={note.path} className="flex shrink-0 items-stretch">
              <PanelTab selected={active?.path === note.path} onClick={() => onSelectNote(note.path)}>
                {note.name}
              </PanelTab>
              <button
                type="button"
                aria-label={t(($) => $.panel.close_note, { name: note.name })}
                onClick={() => onCloseNote(note.path)}
                className="mr-1 flex items-center rounded-sm px-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <KeptPane visible={active == null}>
          <ChatDetailsPanel
            key={chat.id}
            wsId={wsId}
            chat={chat}
            userId={userId}
            variant="page"
            onOpenMember={onOpenMember}
          />
        </KeptPane>
        {Object.entries(retained).map(([noteChatId, chatNotes]) =>
          chatNotes.map((note) => {
            const selected = noteChatId === chat.id && note.path === active?.path;
            return (
              <KeptPane key={`${noteChatId}:${note.path}`} visible={selected}>
                <Suspense fallback={<NoteLoading />}>
                  <KnowledgeDocument
                    path={note.path}
                    variant="page"
                    onAskSelection={(text, from) => {
                      const passage = text.replaceAll("\u0000", "").trim();
                      if (!passage) return;
                      const name = note.name.trim() || note.path.split("/").pop() || note.path;
                      const placed = insertExcerpt(noteChatId, {
                        name,
                        path: note.path,
                        text: passage,
                        ...(typeof from === "number" ? { from } : {}),
                      });
                      if (!placed) onReturnToComposer?.();
                    }}
                  />
                </Suspense>
                {chrome === "page" && (
                  <DocumentVoiceAsk path={note.path} name={note.name} chatId={noteChatId} onSent={onReturnToComposer} />
                )}
              </KeptPane>
            );
          }),
        )}
      </div>
    </>
  );

  if (chrome === "page") return <div className="flex min-h-0 w-full flex-1 flex-col">{body}</div>;
  return (
    <div ref={columnRef} className="relative flex h-full shrink-0 flex-col border-l" style={{ width }}>
      {body}
      <ColumnResizeHandle edge="left" width={width} options={options} onCommit={commit} label={t(($) => $.panel.resize)} />
    </div>
  );
}

/** One side-panel page. Hidden pages stay mounted so their memory survives the switch. */
function KeptPane({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div
      className={cn("min-h-0 min-w-0 flex-1 flex-col", visible && "flex")}
      hidden={!visible}
      inert={!visible}
    >
      {children}
    </div>
  );
}

function NoteLoading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function PanelTab({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={children}
      onClick={onClick}
      className={cn(
        "flex h-full max-w-40 shrink-0 items-center border-b-2 px-3 text-caption focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "border-foreground bg-background font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground",
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}
