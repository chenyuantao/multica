import type { AskAIPage, Comment, DocFile, GroupChat } from "@multica/core/types";
import { THINKING_MESSAGE } from "./im-utils";
import { noteTitle } from "./knowledge-utils";
import type { DirectoryEntry } from "./use-chat-directory";

/** Must match `groupchat.AskNoteMaxRunes` on the server. */
export const ASK_NOTE_MAX_CHARS = 24000;

/** The open note; its body is cut at ASK_NOTE_MAX_CHARS code points. */
export function noteAskPage(path: string, file: DocFile | undefined): AskAIPage {
  const chars = Array.from(file?.content ?? "");
  return {
    note: {
      title: noteTitle(path.split("/").pop() ?? path),
      path,
      modified_at: file?.modified_at ?? "",
      content: chars.slice(0, ASK_NOTE_MAX_CHARS).join(""),
      truncated: chars.length > ASK_NOTE_MAX_CHARS,
    },
  };
}

/** The open chat with its agents and the messages in `visibleIds`, oldest first. */
export function chatAskPage(
  chat: GroupChat,
  title: string,
  messages: readonly Comment[],
  visibleIds: ReadonlySet<string>,
  getActorName: (type: string, id: string) => string,
): AskAIPage {
  return {
    chat: {
      title,
      agents: chat.members.filter((m) => m.member_type === "agent").map((m) => getActorName("agent", m.member_id)),
      messages: messages
        .filter(
          (m) =>
            visibleIds.has(m.id) &&
            m.author_type !== "system" &&
            m.type !== "status_change" &&
            m.type !== "system" &&
            !(m.author_type === "agent" && m.content === THINKING_MESSAGE),
        )
        .map((m) => ({ id: m.id, time: m.created_at, sender: getActorName(m.author_type, m.author_id), content: m.content })),
    },
  };
}

export function contactAskPage(entry: DirectoryEntry): AskAIPage {
  return { contact: { type: entry.type, name: entry.name, description: entry.detail } };
}

/** IDs of `[data-message-id]` rows at least partly inside their scroll area and the window. */
export function visibleMessageIds(root: ParentNode = document): Set<string> {
  const ids = new Set<string>();
  const view = { top: 0, bottom: window.innerHeight };
  for (const el of root.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const rect = el.getBoundingClientRect();
    const box = scrollParent(el)?.getBoundingClientRect() ?? view;
    const top = Math.max(box.top, view.top);
    const bottom = Math.min(box.bottom, view.bottom);
    if (rect.height > 0 && rect.bottom > top && rect.top < bottom) ids.add(el.dataset.messageId ?? "");
  }
  ids.delete("");
  return ids;
}

/** The text highlighted inside `el`; empty when nothing is, or the highlight leaves it. */
export function highlightedTextWithin(el: Element): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
  if (!el.contains(sel.getRangeAt(0).commonAncestorContainer)) return "";
  return sel.toString().trim();
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}
