"use client";

import { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Quote,
  SearchIcon,
  Sparkles,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import { MAX_FILE_SIZE } from "@multica/core/constants/upload";
import { useAskAI } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import type { AskAIElement, AskAIPage, AskAISelection } from "@multica/core/types";
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
import { ShortcutKeycaps } from "../common/shortcut-keycaps";
import { FileDropOverlay, useFileDropZone } from "../editor";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { describeElement, elementLabel } from "./ask-ai-element";
import { cancelledNoticeTrigger } from "./cancelled-notice";
import { isChatHistoryContent } from "./chat-history";
import { ElementPicker } from "./element-picker";
import { plainTextPreview } from "./im-utils";
import { SEARCH_ITEM_CLASS, SearchResultGroups, SearchResultNotice } from "./im-search-results";
import type { SearchScope, SearchSection } from "./im-search-utils";
import { loadErrorText } from "./knowledge-sidebar";
import type { AskAIDialogState } from "./use-ask-ai-launcher";
import { useImSearchGroups, type SearchRow } from "./use-im-search-groups";
import type { DirectoryEntry } from "./use-chat-directory";

const ASK_VALUE = "ask-ai";
const SCOPES: SearchScope[] = ["all", "chats", "contacts", "notes"];
const ALL_SECTIONS: SearchSection[] = ["chats", "contacts", "notes"];

interface ImSearchDialogProps extends AskAIDialogState {
  /** Opens a chat from the current page; defaults to navigating to it. */
  onOpenChat?: (chatId: string) => void;
  onOpenContact?: (entry: DirectoryEntry) => void;
  onOpenNote?: (path: string) => void;
  /** `page` fills a phone level. The dialog is the desktop modal. */
  presentation?: "dialog" | "page";
}

/**
 * Quick switcher across chats, contacts and knowledge notes, opened with the
 * `openKnowledgeSearch` shortcut (Mod+O) or an Ask AI entry on the IM
 * surfaces. The All tab shows one group per kind, three rows at a time until
 * "view all" expands that group; the other tabs search a single kind. The
 * first row always asks AI: the server picks an agent and
 * the question, its files, the page and whatever was picked on it go to the
 * user's direct chat with it. The element picker hides the dialog until a
 * node is clicked. Attaching a file makes the dialog a question only.
 * Phones mount the same switcher as `presentation="page"`.
 */
export function ImSearchDialog({
  open,
  onOpenChange,
  page,
  selection,
  onClearSelection,
  onOpenChat,
  onOpenContact,
  onOpenNote,
  presentation = "dialog",
}: ImSearchDialogProps) {
  const { t } = useT("im");
  const { t: tEditor } = useT("editor");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const askAI = useAskAI(wsId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<SearchScope>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<SearchSection>>(() => new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [active, setActive] = useState("");
  const [picking, setPicking] = useState(false);
  /** Picking started from the shortcut with the dialog closed; cancelling closes it again. */
  const [pickOnly, setPickOnly] = useState(false);
  const [element, setElement] = useState<AskAIElement | null>(null);
  const asking = files.length > 0;
  const canAsk = (query.trim().length > 0 || asking) && !askAI.isPending;
  const sections = scope === "all" ? ALL_SECTIONS : [scope];
  const results = useImSearchGroups({
    open,
    query,
    sections,
    priority: "chats",
    preview: scope === "all",
    expanded,
    suspended: asking,
  });
  const { trimmed, searching, groups, stale, fetching, sectionError, highlight, noteQuery, noteTruncated } = results;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isImeComposing(e)) return;
      const toggle = shortcutMatchesEvent(getShortcut("openKnowledgeSearch"), e);
      const pickShortcut = shortcutMatchesEvent(getShortcut("askAIPickElement"), e);
      if (!toggle && !pickShortcut) return;
      // Another dialog or menu owns the keyboard; only our own may be toggled.
      if (!open && isPortalLayerShortcutTarget(e.target)) return;
      e.preventDefault();
      if (toggle) {
        onOpenChange(!open);
      } else if (picking) {
        cancelPick();
      } else {
        // Picking first, so the dialog only appears once a node is chosen.
        if (!open) onOpenChange(true);
        startPick(!open);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (open) return;
    setQuery("");
    setScope("all");
    setExpanded(new Set());
    setFiles([]);
    setPicking(false);
    setElement(null);
  }, [open]);

  const [expandedFor, setExpandedFor] = useState(`${scope}\n${query}`);
  const expandedKey = `${scope}\n${query}`;
  if (expandedFor !== expandedKey) {
    setExpandedFor(expandedKey);
    setExpanded(new Set());
  }

  useEffect(() => {
    if (presentation !== "page" || !open) return;
    inputRef.current?.focus();
  }, [presentation, open]);

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

  // Rows answering an earlier keyword must not be actionable, or Enter would
  // jump to a result the user has already typed past.
  const rowsKey = groups.flatMap((group) => group.rows.map((row) => row.value)).join("\n");

  const askFirst = searching || asking;
  useEffect(() => {
    setActive(askFirst ? ASK_VALUE : stale ? "" : (rowsKey.split("\n")[0] ?? ""));
  }, [rowsKey, stale, askFirst]);

  const changeScope = (next: SearchScope) => {
    setScope(next);
    inputRef.current?.focus();
  };

  const startPick = (closeOnCancel: boolean) => {
    setPicking(true);
    setPickOnly(closeOnCancel);
  };
  const cancelPick = () => {
    setPicking(false);
    if (pickOnly) onOpenChange(false);
  };
  const pick = (el: Element) => {
    setElement(describeElement(el, navigation));
    setPicking(false);
  };

  // The dialog stays open until the question is sent, so a failure can be retried.
  const ask = () => {
    if (!canAsk) return;
    const context: AskAIPage | null =
      selection || element
        ? { ...page, ...(selection ? { selection } : {}), ...(element ? { element } : {}) }
        : page;
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

  const choose = (row: SearchRow) => {
    onOpenChange(false);
    if (row.kind === "chat") {
      if (onOpenChat) onOpenChat(row.chat.id);
      else navigation.push(paths.imChat(row.chat.id));
    } else if (row.kind === "contact") {
      if (onOpenContact) onOpenContact(row.entry);
      else navigation.push(paths.memberContact(row.entry.type, row.entry.id));
    } else if (row.kind === "note") {
      if (onOpenNote) onOpenNote(row.node.path);
      else navigation.push(paths.knowledgeFile(row.node.path));
    } else {
      navigation.push(paths.collectItem(row.id));
    }
  };

  const expand = (section: SearchSection) => setExpanded((prev) => new Set(prev).add(section));

  const command = (
        <CommandPrimitive
          {...dropZoneProps}
          shouldFilter={false}
          loop
          value={active}
          onValueChange={setActive}
          className={
            presentation === "page"
              ? "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
              : "relative flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground"
          }
        >
          <AskContextQuote
            selection={selection}
            element={element}
            onClearSelection={onClearSelection}
            onClearElement={() => setElement(null)}
          />
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
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mr-2 shrink-0 text-muted-foreground"
              onClick={() => startPick(false)}
              aria-label={t(($) => $.search.pick_element)}
              title={t(($) => $.search.pick_element)}
            >
              <SquareDashedMousePointer />
            </Button>
            <FileUploadButton multiple className="-mx-1 shrink-0" onSelect={(file) => addFiles([file])} />
            <ShortcutKeycaps
              shortcut={createShortcutChord("Escape")}
              className={presentation === "page" ? "hidden" : "hidden shrink-0 sm:inline-flex"}
            />
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

          <CommandPrimitive.List
            className={
              presentation === "page"
                ? "min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
                : "max-h-[min(440px,55vh)] overflow-x-hidden overflow-y-auto"
            }
          >
            <CommandPrimitive.Group className={asking ? "p-2" : "px-2 pt-2"}>
              <CommandPrimitive.Item value={ASK_VALUE} disabled={!canAsk} onSelect={ask} className={SEARCH_ITEM_CLASS}>
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
            {asking ? null : sectionError ? (
              <SearchResultNotice>
                {sectionError.section === "notes" ? loadErrorText(sectionError.error, t) : t(($) => $.search.load_failed)}
              </SearchResultNotice>
            ) : groups.length > 0 ? (
              <SearchResultGroups
                groups={groups}
                stale={stale}
                highlight={highlight}
                noteQuery={noteQuery}
                userId={userId}
                onChoose={choose}
                onExpand={expand}
              />
            ) : fetching || stale ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <SearchResultNotice>{searching ? t(($) => $.search.no_results) : t(($) => $.search.empty)}</SearchResultNotice>
            )}
            {noteTruncated && (
              <p className="px-5 pb-3 text-caption text-muted-foreground">{t(($) => $.knowledge.truncated)}</p>
            )}
          </CommandPrimitive.List>
          {isDragOver && <FileDropOverlay />}
        </CommandPrimitive>
  );

  if (presentation === "page") {
    return (
      <div data-element-picker-ignore="" className="flex min-h-0 flex-1 flex-col">
        <h2 className="sr-only">{t(($) => $.search.title)}</h2>
        {picking ? <ElementPicker onPick={pick} onCancel={cancelPick} /> : command}
      </div>
    );
  }

  return (
    <Dialog open={open && !picking} onOpenChange={onOpenChange}>
      {picking && <ElementPicker onPick={pick} onCancel={cancelPick} />}
      <DialogContent
        data-element-picker-ignore=""
        className="top-[20%] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl!"
        showCloseButton={false}
        initialFocus={inputRef}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t(($) => $.search.title)}</DialogTitle>
        </DialogHeader>
        {command}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the person picked to ask about, quoted above the input. The page
 * itself is sent too but never shown here.
 */
function AskContextQuote({
  selection,
  element,
  onClearSelection,
  onClearElement,
}: {
  selection: AskAISelection | null;
  element: AskAIElement | null;
  onClearSelection: () => void;
  onClearElement: () => void;
}) {
  const { t } = useT("im");
  const lines: { key: string; icon: typeof FileText; text: string; onClear: () => void }[] = [];
  if (selection) {
    const raw = selection.text || selection.content;
    const text = isChatHistoryContent(raw)
      ? t(($) => $.thread.history_footer)
      : cancelledNoticeTrigger(raw) !== null
        ? t(($) => $.thread.cancelled_in_progress)
        : plainTextPreview(raw) || t(($) => $.thread.quote_attachment);
    lines.push({
      key: "selection",
      icon: Quote,
      text: t(($) => $.thread.quote_line, { name: selection.sender, text }),
      onClear: onClearSelection,
    });
  }
  if (element) {
    lines.push({ key: "element", icon: SquareDashedMousePointer, text: elementLabel(element), onClear: onClearElement });
  }
  if (lines.length === 0) return null;
  return (
    <ul
      aria-label={t(($) => $.search.context)}
      className="mx-3 mt-3 flex flex-col gap-0.5 rounded-lg border-l-2 border-brand bg-muted/60 py-1 pr-1 pl-2.5 text-caption text-muted-foreground"
    >
      {lines.map(({ key, icon: Icon, text, onClear }) => {
        const label = text.replace(/\s+/g, " ").trim();
        return (
          <li key={key} className="flex min-w-0 items-center gap-1.5">
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={label}>
              {label}
            </span>
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
          </li>
        );
      })}
    </ul>
  );
}
