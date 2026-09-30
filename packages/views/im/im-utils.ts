import type { Comment, GroupChat, GroupChatMemberType, TaskMessagePayload } from "@multica/core/types";

/** Messages closer than this read as one exchange and share a time separator. */
const SEPARATOR_GAP_MS = 5 * 60 * 1000;

/** Must match `groupchat.ThinkingMessage` on the server. */
export const THINKING_MESSAGE = "思考中...";

/** The run whose progress an agent's still-unfilled thinking bubble stands in for. */
export function thinkingTaskId(message: Comment): string | null {
  if (message.author_type !== "agent" || message.content !== THINKING_MESSAGE) return null;
  return message.source_task_id || null;
}

/** The latest text the run has said so far; tool calls and reasoning are not progress. */
export function latestProgressText(messages: readonly TaskMessagePayload[] | undefined): string | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const text = m?.type === "text" ? m.content?.trim() : "";
    if (text) return text;
  }
  return null;
}

export interface ComposerMention {
  name: string;
  type: GroupChatMemberType;
  id: string;
}

/** One-line preview of a markdown message for the chat list. */
export function plainTextPreview(markdown: string): string {
  return markdown
    .replace(/\[(@?[^\]]+)\]\(mention:\/\/[^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rewrites each picked `@Name` in the composer text into the mention link the
 * server parses. Longer names go first so `@Dev Ops` wins over `@Dev`.
 */
/**
 * Encodes picked @names into mention links. A bare @Name that matches more
 * than one candidate, without exactly one picked person of that name, is
 * refused instead of choosing one.
 */
export function resolveComposerMentions(
  text: string,
  picked: ComposerMention[],
  candidates: ComposerMention[],
): { ok: true; markdown: string } | { ok: false; name: string } {
  const names = new Set<string>();
  for (const token of text.matchAll(/(^|\s)@([^\s@]+)/g)) {
    const name = (token[2] ?? "").replace(/[.,;:!?]+$/, "");
    if (name) names.add(name);
  }
  for (const name of names) {
    const same = candidates.filter((c) => c.name.toLowerCase() === name.toLowerCase());
    if (same.length <= 1) continue;
    const chosen = picked.filter((p) => same.some((c) => c.type === p.type && c.id === p.id));
    const unique = new Map(chosen.map((p) => [`${p.type}:${p.id}`, p]));
    if (unique.size !== 1) return { ok: false, name };
  }
  return { ok: true, markdown: encodeMentions(text, picked) };
}

export function encodeMentions(text: string, mentions: ComposerMention[]): string {
  const unique = new Map(mentions.map((m) => [`${m.type}:${m.id}`, m]));
  const ordered = [...unique.values()].sort((a, b) => b.name.length - a.name.length);
  if (ordered.length === 0) return text;
  const byName = new Map(ordered.map((m) => [m.name, m]));
  // One alternation pass so a short name never re-matches inside a link
  // already produced for a longer one.
  const pattern = new RegExp(`@(${ordered.map((m) => escapeRegExp(m.name)).join("|")})`, "g");
  return text.replace(pattern, (token, name: string) => {
    const m = byName.get(name);
    return m ? `[@${m.name}](mention://${m.type}/${m.id})` : token;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `@query` being typed at the caret, if any. The query may not contain
 * whitespace; `@` must start the text or follow whitespace.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, query };
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function needsTimeSeparator(prevIso: string | undefined, currIso: string): boolean {
  if (!prevIso) return true;
  const prev = new Date(prevIso);
  const curr = new Date(currIso);
  return !isSameDay(prev, curr) || curr.getTime() - prev.getTime() > SEPARATOR_GAP_MS;
}

export type DayRelation = "today" | "yesterday" | "other";

export function dayRelation(iso: string, now: Date): DayRelation {
  const d = new Date(iso);
  if (isSameDay(d, now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameDay(d, yesterday) ? "yesterday" : "other";
}

export function formatClock(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** Chat list stamp: clock time today, weekday within a week, else the date. */
export function formatListStamp(iso: string, locale: string, now: Date): string {
  const d = new Date(iso);
  if (isSameDay(d, now)) return formatClock(iso, locale);
  const ageMs = now.getTime() - d.getTime();
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return d.toLocaleDateString(locale, { weekday: "short" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** The time a chat was last active: its latest message, or its creation. */
export function chatActivityAt(chat: GroupChat): string {
  return chat.last_comment_at ?? chat.created_at;
}

export function sortChatsByActivity(chats: GroupChat[]): GroupChat[] {
  return [...chats].sort((a, b) => chatActivityAt(b).localeCompare(chatActivityAt(a)));
}
