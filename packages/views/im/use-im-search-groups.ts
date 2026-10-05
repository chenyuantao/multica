"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { messageCollectionListOptions } from "@multica/core/collections";
import { docsSearchOptions, docsTreeOptions } from "@multica/core/docs";
import { groupChatListOptions, groupChatSearchOptions } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import type { DocNode, GroupChat, MessageCollection } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { useDebouncedValue } from "../common/use-debounced-value";
import { useT } from "../i18n";
import { cancelledNoticeTrigger } from "./cancelled-notice";
import { collectionListTitle, collectionSearchText, isChatHistoryContent, type HistoryLabels } from "./chat-history";
import { chatDisplayTitle, plainTextPreview, sortChats } from "./im-utils";
import {
  orderSearchSections,
  previewSearchRows,
  rankChats,
  rankContacts,
  rankFavorites,
  rankNotes,
  type SearchSection,
} from "./im-search-utils";
import { flattenFiles, recentFiles } from "./knowledge-utils";
import { entryKey, useChatDirectory, type DirectoryEntry } from "./use-chat-directory";

/** A single-kind tab shows this many hits; grouped search previews three and expands the rest. */
const SCOPE_LIMIT = 50;
const RECENT_LIMIT = 20;

const EMPTY_CHATS: GroupChat[] = [];
const EMPTY_NODES: DocNode[] = [];
const EMPTY_FAVORITES: MessageCollection[] = [];

export type SearchRow =
  | { kind: "chat"; value: string; chat: GroupChat; title: string; snippet: string }
  | { kind: "contact"; value: string; entry: DirectoryEntry }
  | { kind: "note"; value: string; node: DocNode }
  | { kind: "favorite"; value: string; id: string; title: string; source: string; sender: string };

export interface SearchGroup {
  section: SearchSection;
  heading?: string;
  rows: SearchRow[];
  /** Rows held behind the section's "view all" control. */
  hidden: number;
}

interface UseImSearchGroupsOptions {
  open: boolean;
  query: string;
  /** Sections to search. The sidebar passes all four. */
  sections: readonly SearchSection[];
  /** Section rendered first. The others keep their usual order. */
  priority: SearchSection;
  /**
   * Grouped results preview three rows per section. A single-kind tab passes
   * false and shows its own longer list instead.
   */
  preview: boolean;
  expanded: ReadonlySet<SearchSection>;
  /** Ask AI with attachments: skip every search. */
  suspended?: boolean;
}

/**
 * Chats, contacts, knowledge notes, and saved messages for the command bar
 * and the sidebar search. Grouped results (`preview`) put `priority` first
 * and collapse each section after three rows.
 */
export function useImSearchGroups({
  open,
  query,
  sections,
  priority,
  preview,
  expanded,
  suspended = false,
}: UseImSearchGroupsOptions) {
  const { t } = useT("im");
  const wsId = useWorkspaceId();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const { getActorName } = useActorName();
  const directory = useChatDirectory(wsId);
  const trimmed = query.trim();
  const q = useDebouncedValue(trimmed, 200);
  const searching = trimmed.length > 0 && !suspended;
  const wants = (section: SearchSection) => !suspended && sections.includes(section);

  const chatList = useQuery({ ...groupChatListOptions(wsId), enabled: open && wants("chats") });
  const tree = useQuery({ ...docsTreeOptions(), enabled: open && !searching && wants("notes") });
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
  const collectionList = useQuery({
    ...messageCollectionListOptions(wsId),
    enabled: open && wants("favorites"),
  });

  const chats = chatList.data ?? EMPTY_CHATS;
  const titleOf = (chat: GroupChat) => chatDisplayTitle(chat, userId, getActorName);
  const labels: Record<SearchSection, string> = {
    chats: t(($) => $.search.chats),
    contacts: t(($) => $.search.contacts),
    notes: t(($) => $.search.notes),
    favorites: t(($) => $.search.favorites),
  };
  const historyLabels: HistoryLabels = {
    image: t(($) => $.thread.history_image),
    document: t(($) => $.thread.history_document),
    history: t(($) => $.thread.history_record),
  };
  const favorites = [...(collectionList.data ?? EMPTY_FAVORITES)].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
  const favoriteTitle = (item: MessageCollection) =>
    collectionListTitle(item.content, historyLabels) || t(($) => $.collect.untitled);
  const chatRow = (chat: GroupChat, title: string, snippet: string): SearchRow => ({
    kind: "chat",
    value: `chat:${chat.id}`,
    chat,
    title,
    snippet: !snippet
      ? ""
      : cancelledNoticeTrigger(snippet) !== null
        ? t(($) => $.thread.cancelled_in_progress)
        : isChatHistoryContent(snippet)
          ? t(($) => $.thread.history_footer)
          : plainTextPreview(snippet),
  });
  const contactRow = (entry: DirectoryEntry): SearchRow => ({
    kind: "contact",
    value: `contact:${entryKey(entry.type, entry.id)}`,
    entry,
  });
  const noteRow = (node: DocNode): SearchRow => ({ kind: "note", value: `note:${node.path}`, node });
  const favoriteRow = (item: MessageCollection, title: string): SearchRow => ({
    kind: "favorite",
    value: `favorite:${item.id}`,
    id: item.id,
    title,
    source: item.source_title,
    sender: item.sender_name,
  });

  const present = (section: SearchSection, rows: SearchRow[], heading?: string): SearchGroup => {
    if (!preview) {
      const limit = searching ? SCOPE_LIMIT : RECENT_LIMIT;
      return { section, heading: searching ? undefined : heading, rows: rows.slice(0, limit), hidden: 0 };
    }
    const capped = previewSearchRows(rows, expanded.has(section));
    return { section, heading, rows: capped.visible, hidden: capped.hidden };
  };

  const groups: SearchGroup[] = [];
  for (const section of orderSearchSections(priority)) {
    if (!wants(section)) continue;
    if (searching) {
      if (section === "chats" && (preview ? !chatSearch.isError : true)) {
        const ranked = rankChats(chats, chatSearch.data?.hits ?? [], q, titleOf);
        groups.push(present("chats", ranked.map((row) => chatRow(row.chat, row.title, row.snippet)), labels.chats));
      } else if (section === "contacts") {
        const ranked = rankContacts([...directory.people, ...directory.agents], q);
        groups.push(present("contacts", ranked.map((row) => contactRow(row.entry)), labels.contacts));
      } else if (section === "notes" && !noteSearch.isError) {
        const ranked = rankNotes(flattenFiles(noteSearch.data?.nodes ?? EMPTY_NODES));
        groups.push(present("notes", ranked.map(noteRow), labels.notes));
      } else if (section === "favorites" && !collectionList.isError) {
        const ranked = rankFavorites(favorites, q, favoriteTitle, (item) => collectionSearchText(item.content));
        groups.push(
          present(
            "favorites",
            ranked.map((row) => favoriteRow(row.item, row.title)),
            labels.favorites,
          ),
        );
      }
      continue;
    }
    if (section === "chats") {
      const recent = sortChats(chats).map((chat) => chatRow(chat, titleOf(chat), ""));
      groups.push(present("chats", recent, t(($) => $.search.recent_chats)));
    } else if (section === "contacts") {
      // The contacts tab lists the directory with no heading. Grouped search
      // shows it before a query on every page, so chats, contacts, notes, and
      // favorites all appear whether the field was opened from messages, members, knowledge, or favorites.
      const heading = preview ? labels.contacts : undefined;
      groups.push(present("contacts", [...directory.people, ...directory.agents].map(contactRow), heading));
    } else if (section === "notes" && !tree.isError) {
      const recent = recentFiles(tree.data ?? EMPTY_NODES, RECENT_LIMIT).map(noteRow);
      groups.push(present("notes", recent, t(($) => $.search.recent_notes)));
    } else if (section === "favorites" && !collectionList.isError) {
      groups.push(
        present(
          "favorites",
          favorites.map((item) => favoriteRow(item, favoriteTitle(item))),
          t(($) => $.search.recent_favorites),
        ),
      );
    }
  }

  const visible = groups.filter((group) => group.rows.length > 0);
  const pending = [...(wants("chats") ? [chatSearch] : []), ...(wants("notes") ? [noteSearch] : [])];
  const stale = searching && (q !== trimmed || pending.some((query) => query.isPlaceholderData));
  const fetching =
    pending.some((query) => query.isFetching) ||
    chatList.isFetching ||
    collectionList.isFetching ||
    (!searching && tree.isFetching);
  const only = !preview && sections.length === 1 ? sections[0] : null;
  const failed =
    only === "chats"
      ? searching
        ? chatSearch
        : chatList
      : only === "notes"
        ? searching
          ? noteSearch
          : tree
        : only === "favorites"
          ? collectionList
          : null;
  const sectionError = failed?.isError ? { section: only!, error: failed.error } : null;

  return {
    trimmed,
    searching,
    groups: visible,
    stale,
    fetching,
    sectionError,
    highlight: searching ? q : "",
    noteQuery: searching ? (noteSearch.data?.query ?? "") : "",
    noteTruncated: searching && !stale && wants("notes") && noteSearch.data?.truncated === true,
  };
}
