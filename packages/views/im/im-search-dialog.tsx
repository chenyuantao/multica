"use client";

import { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  MessagesSquare,
  Quote,
  SearchIcon,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import { MAX_FILE_SIZE } from "@multica/core/constants/upload";
import { docsSearchOptions, docsTreeOptions } from "@multica/core/docs";
import { groupChatListOptions, groupChatSearchOptions, useAskAI } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import type { AskAIPage, DocNode, GroupChat } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import {
  createShortcutChord,
  getShortcut,
  isPortalLayerShortcutTarget,
  shortcutMatchesEvent,
} from "@multica/core/shortcuts";
import { isImeComposing } from "@multica/core/utils";
import { FileUploadButton } from "@multica/ui/components/common/file-upload-button";
import { Button } from "@multica/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import { ActorAvatar } from "../common/actor-avatar";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";
import { useDebouncedValue } from "../common/use-debounced-value";
import { FileDropOverlay, useFileDropZone } from "../editor";
import { useLocale, useT } from "../i18n";
import { useNavigation } from "../navigation";
import { HighlightText } from "../search/highlight-text";
import { ChatAvatar } from "./chat-sidebar";
import { chatActivityAt, chatDisplayTitle, formatListStamp, plainTextPreview, sortChats } from "./im-utils";
import { rankChats, rankContacts, rankNotes, type SearchScope } from "./im-search-utils";
import { loadErrorText } from "./knowledge-sidebar";
import { flattenFiles, noteTitle, parentDir, recentFiles } from "./knowledge-utils";
import type { AskAIDialogState } from "./use-ask-ai-launcher";
import { entryKey, useChatDirectory, type DirectoryEntry } from "./use-chat-directory";

/** Rows per group on the All tab; the rest sit behind the group's "show all" row. */
const ALL_GROUP_LIMIT = 5;
const SCOPE_LIMIT = 50;
const RECENT_LIMIT = 20;
const ASK_VALUE = "ask-ai";
const SCOPES: SearchScope[] = ["all", "chats", "contacts", "notes"];
const EMPTY_CHATS: GroupChat[] = [];
const EMPTY_NODES: DocNode[] = [];

const GROUP_CLASS =
  "p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";
const ITEM_CLASS =
  "flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-body outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent";

type Row =
  | { kind: "chat"; value: string; chat: GroupChat; title: string; snippet: string }
  | { kind: "contact"; value: string; entry: DirectoryEntry }
  | { kind: "note"; value: string; node: DocNode };

interface Group {
  scope: Exclude<SearchScope, "all">;
  heading?: string;
  rows: Row[];
  /** Rows left out by the All tab's per-group limit. */
  hidden: number;
}

interface ImSearchDialogProps extends AskAIDialogState {
  /** Opens a chat from the current page; defaults to navigating to it. */
  onOpenChat?: (chatId: string) => void;
  onOpenContact?: (entry: DirectoryEntry) => void;
  onOpenNote?: (path: string) => void;
}

/**
 * Quick switcher across chats, contacts and knowledge notes, opened with the
 * `openKnowledgeSearch` shortcut (Mod+O) or an Ask AI entry on the IM
 * surfaces. The All tab shows one group per kind; the other tabs search a
 * single kind. The first row always asks AI: the server picks an agent and
 * the question, its files and the quoted page go to the user's direct chat
 * with it. Attaching a file makes the dialog a question only.
 */
export function ImSearchDialog({
  open,
  onOpenChange,
  context,
  onClearContext,
  onOpenChat,
  onOpenContact,
  onOpenNote,
}: ImSearchDialogProps) {
  const { t } = useT("im");
  const { t: tEditor } = useT("editor");
  const locale = useLocale();
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const { getActorName } = useActorName();
  const directory = useChatDirectory(wsId);
  const askAI = useAskAI(wsId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<SearchScope>("all");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [active, setActive] = useState("");
  const trimmed = query.trim();
  const q = useDebouncedValue(trimmed, 200);
  const asking = files.length > 0;
  const searching = trimmed.length > 0 && !asking;
  const canAsk = (trimmed.length > 0 || asking) && !askAI.isPending;
  const wants = (kind: Exclude<SearchScope, "all">) => !asking && (scope === "all" || scope === kind);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isImeComposing(e)) return;
      if (!shortcutMatchesEvent(getShortcut("openKnowledgeSearch"), e)) return;
      // Another dialog or menu owns the keyboard; only our own may be toggled.
      if (!open && isPortalLayerShortcutTarget(e.target)) return;
      e.preventDefault();
      onOpenChange(!open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setScope("all");
    setFiles([]);
  }, [open]);

  const addFiles = (list: File[]) => {
    const fit = list.filter((file) => {
      if (file.size <= MAX_FILE_SIZE) return true;
      toast.error(tEditor(($) => $.upload.failed, { filename: file.name, reason: "File exceeds 100 MB limit" }));
      return false;
    });
    if (fit.length === 0) return;
    setFiles((prev) => [...prev, ...fit]);
    inputRef.current?.focus();
  };
  const { isDragOver, dropZoneProps } = useFileDropZone({ onDrop: addFiles });

  const chatList = useQuery({ ...groupChatListOptions(wsId), enabled: open && !asking });
  const tree = useQuery({ ...docsTreeOptions(), enabled: open && !searching && wants("notes") });
  // Previous hits stay painted while the next keyword is in flight so the
  // list does not strobe on every keystroke.
  const chatSearch = useQuery({
    ...groupChatSearchOptions(wsId, q),
    enabled: open && q.length > 0 && wants("chats"),
    placeholderData: keepPreviousData,
  });
  const noteSearch = useQuery({
    ...docsSearchOptions(q),
    enabled: open && q.length > 0 && wants("notes"),
    placeholderData: keepPreviousData,
  });

  const chats = chatList.data ?? EMPTY_CHATS;
  const titleOf = (chat: GroupChat) => chatDisplayTitle(chat, userId, getActorName);
  const limit = scope === "all" ? ALL_GROUP_LIMIT : searching ? SCOPE_LIMIT : RECENT_LIMIT;
  const group = (kind: Group["scope"], rows: Row[], heading?: string): Group => ({
    scope: kind,
    // With one kind of hits on screen its heading only repeats the tab.
    heading: scope === "all" || !searching ? heading : undefined,
    rows: rows.slice(0, limit),
    hidden: scope === "all" ? Math.max(0, rows.length - limit) : 0,
  });
  const chatRow = (chat: GroupChat, title: string, snippet: string): Row => ({
    kind: "chat",
    value: `chat:${chat.id}`,
    chat,
    title,
    snippet: snippet ? plainTextPreview(snippet) : "",
  });
  const contactRow = (entry: DirectoryEntry): Row => ({
    kind: "contact",
    value: `contact:${entryKey(entry.type, entry.id)}`,
    entry,
  });
  const noteRow = (node: DocNode): Row => ({ kind: "note", value: `note:${node.path}`, node });

  // Only the All tab hides a failing kind; a single-kind tab reports it.
  const groups: Group[] = [];
  if (searching) {
    if (wants("chats") && (scope === "chats" || !chatSearch.isError)) {
      const ranked = rankChats(chats, chatSearch.data?.hits ?? [], q, titleOf);
      groups.push(group("chats", ranked.map((r) => chatRow(r.chat, r.title, r.snippet)), t(($) => $.search.chats)));
    }
    if (wants("contacts")) {
      const ranked = rankContacts([...directory.people, ...directory.agents], q);
      groups.push(group("contacts", ranked.map((r) => contactRow(r.entry)), t(($) => $.search.contacts)));
    }
    if (wants("notes") && !noteSearch.isError) {
      const ranked = rankNotes(flattenFiles(noteSearch.data?.nodes ?? EMPTY_NODES));
      groups.push(group("notes", ranked.map(noteRow), t(($) => $.search.notes)));
    }
  } else {
    if (wants("chats")) {
      const recent = sortChats(chats).map((chat) => chatRow(chat, titleOf(chat), ""));
      groups.push(group("chats", recent, t(($) => $.search.recent_chats)));
    }
    if (!asking && scope === "contacts") {
      groups.push(group("contacts", [...directory.people, ...directory.agents].map(contactRow)));
    }
    if (wants("notes") && !tree.isError) {
      const recent = recentFiles(tree.data ?? EMPTY_NODES, RECENT_LIMIT).map(noteRow);
      groups.push(group("notes", recent, t(($) => $.search.recent_notes)));
    }
  }
  const visible = groups.filter((g) => g.rows.length > 0);

  // Rows answering an earlier keyword must not be actionable, or Enter would
  // jump to a result the user has already typed past.
  const pending = [...(wants("chats") ? [chatSearch] : []), ...(wants("notes") ? [noteSearch] : [])];
  const stale = searching && (q !== trimmed || pending.some((x) => x.isPlaceholderData));
  const fetching = pending.some((x) => x.isFetching) || chatList.isFetching || (!searching && tree.isFetching);
  const error =
    scope === "chats" ? (searching ? chatSearch : chatList) : scope === "notes" ? (searching ? noteSearch : tree) : null;
  const rowsKey = visible.flatMap((g) => g.rows.map((r) => r.value)).join("\n");

  const askFirst = searching || asking;
  useEffect(() => {
    setActive(askFirst ? ASK_VALUE : stale ? "" : (rowsKey.split("\n")[0] ?? ""));
  }, [rowsKey, stale, askFirst]);

  const changeScope = (next: SearchScope) => {
    setScope(next);
    inputRef.current?.focus();
  };

  // The dialog stays open until the question is sent, so a failure can be retried.
  const ask = () => {
    if (!canAsk) return;
    askAI.mutate(
      { query: trimmed, page: context, files },
      {
        onSuccess: ({ chat }) => {
          onOpenChange(false);
          if (onOpenChat) onOpenChat(chat.id);
          else navigation.push(paths.imChat(chat.id));
        },
        onError: (err) => {
          const noAgent = err instanceof ApiError && (err.body as { code?: string } | undefined)?.code === "ask_ai_no_agent";
          toast.error(noAgent ? t(($) => $.search.ask_no_agent) : t(($) => $.search.ask_failed));
        },
      },
    );
  };

  const choose = (row: Row) => {
    onOpenChange(false);
    if (row.kind === "chat") {
      if (onOpenChat) onOpenChat(row.chat.id);
      else navigation.push(paths.imChat(row.chat.id));
    } else if (row.kind === "contact") {
      if (onOpenContact) onOpenContact(row.entry);
      else navigation.push(paths.memberContact(row.entry.type, row.entry.id));
    } else if (onOpenNote) {
      onOpenNote(row.node.path);
    } else {
      navigation.push(paths.knowledgeFile(row.node.path));
    }
  };

  const highlight = searching ? q : "";
  const noteQuery = searching ? (noteSearch.data?.query ?? "") : "";
  const now = new Date();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20%] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl!"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t(($) => $.search.title)}</DialogTitle>
        </DialogHeader>
        <CommandPrimitive
          {...dropZoneProps}
          shouldFilter={false}
          loop
          value={active}
          onValueChange={setActive}
          className="relative flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground"
        >
          {context && <AskContextQuote context={context} onClear={onClearContext} />}
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              ref={inputRef}
              placeholder={asking ? t(($) => $.search.ask_placeholder) : t(($) => $.search.placeholder)}
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                // cmdk's root handler intercepts Home/End for list navigation;
                // stop propagation so the browser moves the text caret instead.
                if (e.key === "Home" || e.key === "End") e.stopPropagation();
              }}
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files);
                if (pasted.length === 0) return;
                e.preventDefault();
                addFiles(pasted);
              }}
              className="flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
            />
            <FileUploadButton multiple className="-mx-1 shrink-0" onSelect={(file) => addFiles([file])} />
            <ShortcutKeycaps shortcut={createShortcutChord("Escape")} className="hidden shrink-0 sm:inline-flex" />
          </div>
          {asking && (
            <ul className="flex flex-wrap gap-1.5 px-4 pb-2.5">
              {files.map((file, i) => {
                const Icon = file.type.startsWith("image/") ? ImageIcon : FileText;
                return (
                  <li
                    key={`${i}:${file.name}`}
                    className="flex h-7 max-w-60 min-w-0 items-center gap-1.5 rounded-lg bg-muted pr-0.5 pl-2 text-caption"
                  >
                    <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate" title={file.name}>
                      {file.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 rounded-md"
                      disabled={askAI.isPending}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`${tEditor(($) => $.attachment.remove)}: ${file.name}`}
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {asking ? (
            <div className="border-b" />
          ) : (
            <Tabs value={scope} onValueChange={(value) => changeScope(value as SearchScope)} className="border-b px-3">
              <TabsList variant="line" aria-label={t(($) => $.search.scope)}>
                {SCOPES.map((s) => (
                  <TabsTrigger key={s} value={s}>
                    {t(($) => $.search[s])}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <CommandPrimitive.List className="max-h-[min(440px,55vh)] overflow-x-hidden overflow-y-auto">
            <CommandPrimitive.Group className={asking ? "p-2" : "px-2 pt-2"}>
              <CommandPrimitive.Item value={ASK_VALUE} disabled={!canAsk} onSelect={ask} className={ITEM_CLASS}>
                {askAI.isPending ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Sparkles className="size-4 shrink-0 text-brand" strokeWidth={1.7} />
                )}
                <span className="shrink-0 font-medium">
                  {askAI.isPending ? t(($) => $.search.ask_pending) : t(($) => $.search.ask_ai)}
                </span>
                {!askAI.isPending && (trimmed || asking) && (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {trimmed || t(($) => $.search.ask_files, { count: files.length })}
                  </span>
                )}
              </CommandPrimitive.Item>
            </CommandPrimitive.Group>
            {asking ? null : error?.isError ? (
              <Notice>{scope === "notes" ? loadErrorText(error.error, t) : t(($) => $.search.load_failed)}</Notice>
            ) : visible.length > 0 ? (
              visible.map((g) => (
                <CommandPrimitive.Group key={g.scope} heading={g.heading} className={GROUP_CLASS}>
                  {g.rows.map((row) => (
                    <CommandPrimitive.Item
                      key={row.value}
                      value={row.value}
                      disabled={stale}
                      onSelect={() => choose(row)}
                      title={row.kind === "note" ? row.node.path : undefined}
                      className={ITEM_CLASS}
                    >
                      {row.kind === "chat" ? (
                        <ChatResult
                          row={row}
                          userId={userId}
                          query={highlight}
                          stamp={formatListStamp(chatActivityAt(row.chat), locale, now)}
                        />
                      ) : row.kind === "contact" ? (
                        <ContactResult entry={row.entry} userId={userId} query={highlight} />
                      ) : (
                        <NoteResult node={row.node} query={noteQuery} />
                      )}
                    </CommandPrimitive.Item>
                  ))}
                  {g.hidden > 0 && (
                    <CommandPrimitive.Item
                      value={`more:${g.scope}`}
                      disabled={stale}
                      onSelect={() => changeScope(g.scope)}
                      className={`${ITEM_CLASS} text-caption text-muted-foreground`}
                    >
                      {t(($) => $.search.show_all, { total: g.rows.length + g.hidden })}
                    </CommandPrimitive.Item>
                  )}
                </CommandPrimitive.Group>
              ))
            ) : fetching || stale ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Notice>{searching ? t(($) => $.search.no_results) : t(($) => $.search.empty)}</Notice>
            )}
            {searching && !stale && wants("notes") && noteSearch.data?.truncated && (
              <p className="px-5 pb-3 text-caption text-muted-foreground">{t(($) => $.knowledge.truncated)}</p>
            )}
          </CommandPrimitive.List>
          {isDragOver && <FileDropOverlay />}
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

/** What a question carries from the page, quoted above the input. */
function AskContextQuote({ context, onClear }: { context: AskAIPage; onClear: () => void }) {
  const { t } = useT("im");
  const lines: { key: string; icon: typeof FileText; text: string }[] = [];
  if (context.note) lines.push({ key: "note", icon: FileText, text: context.note.title });
  if (context.chat) {
    lines.push({
      key: "chat",
      icon: MessagesSquare,
      text: t(($) => $.search.context_chat, { title: context.chat.title, count: context.chat.messages.length }),
    });
  }
  if (context.contact) lines.push({ key: "contact", icon: UserRound, text: context.contact.name });
  if (context.selection) {
    const s = context.selection;
    const text = plainTextPreview(s.text || s.content) || t(($) => $.thread.quote_attachment);
    lines.push({ key: "selection", icon: Quote, text: t(($) => $.thread.quote_line, { name: s.sender, text }) });
  }
  if (lines.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t(($) => $.search.context)}
      className="mx-3 mt-3 flex items-start gap-1 rounded-lg border-l-2 border-brand bg-muted/60 py-1 pr-1 pl-2.5 text-caption text-muted-foreground"
    >
      <ul className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        {lines.map(({ key, icon: Icon, text }) => {
          const label = text.replace(/\s+/g, " ").trim();
          return (
            <li key={key} className="flex min-w-0 items-center gap-1.5">
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate" title={label}>
                {label}
              </span>
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 rounded-md"
        onClick={onClear}
        aria-label={t(($) => $.search.context_remove)}
        title={t(($) => $.search.context_remove)}
      >
        <X />
      </Button>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-body text-muted-foreground">{children}</p>;
}

function ChatResult({
  row,
  userId,
  query,
  stamp,
}: {
  row: Extract<Row, { kind: "chat" }>;
  userId: string;
  query: string;
  stamp: string;
}) {
  return (
    <>
      <ChatAvatar chat={row.chat} userId={userId} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">
            <HighlightText text={row.title} query={query} />
          </span>
          <span className="shrink-0 text-micro text-muted-foreground tabular-nums">{stamp}</span>
        </span>
        {row.snippet && (
          <span className="block truncate text-caption text-muted-foreground">
            <HighlightText text={row.snippet} query={query} />
          </span>
        )}
      </span>
    </>
  );
}

function ContactResult({ entry, userId, query }: { entry: DirectoryEntry; userId: string; query: string }) {
  const { t } = useT("im");
  const self = entry.type === "member" && entry.id === userId;
  return (
    <>
      <ActorAvatar actorType={entry.type} actorId={entry.id} size="xl" profileLink={false} showStatusDot />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <HighlightText text={entry.name} query={query} />
        </span>
        {(self || entry.detail) && (
          <span className="block truncate text-caption text-muted-foreground">
            {self ? t(($) => $.contacts.you) : <HighlightText text={entry.detail} query={query} />}
          </span>
        )}
      </span>
      <span className="shrink-0 text-caption text-muted-foreground">
        {entry.type === "agent" ? t(($) => $.contacts.agent) : t(($) => $.contacts.person)}
      </span>
    </>
  );
}

function NoteResult({ node, query }: { node: DocNode; query: string }) {
  const dir = parentDir(node.path);
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">
          <HighlightText text={noteTitle(node.name)} query={query} />
        </span>
        {dir && <span className="max-w-[40%] shrink-0 truncate text-caption text-muted-foreground">{dir}</span>}
      </span>
      {node.snippet && (
        <span className="truncate pl-[26px] text-caption text-muted-foreground">
          <HighlightText text={node.snippet} query={query} />
        </span>
      )}
    </span>
  );
}
