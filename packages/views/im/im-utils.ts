import { directChatPeer } from "@multica/core/group-chats";
import type { Comment, GroupChat, GroupChatMemberType, TaskMessagePayload } from "@multica/core/types";
import { buildSteps, isCallStep } from "../common/task-transcript/build-steps";
import { buildTimeline } from "../common/task-transcript/build-timeline";
import { redactSecrets } from "../common/task-transcript/redact";
import { traceEventSummary, traceToolArgSummary } from "../common/task-transcript/trace-event-presenter";

/** Messages closer than this read as one exchange and share a time separator. */
const SEPARATOR_GAP_MS = 5 * 60 * 1000;

/** Must match `groupchat.ThinkingMessage` on the server. */
export const THINKING_MESSAGE = "思考中...";

/** The run whose progress an agent's still-unfilled thinking bubble stands in for. */
export function thinkingTaskId(message: Comment): string | null {
  if (message.author_type !== "agent" || message.content !== THINKING_MESSAGE) return null;
  return message.source_task_id || null;
}

export type RunActivity = { kind: "tool"; label: string } | { kind: "thinking"; label: string };

export interface RunProgress {
  /** The latest text the run has said so far. */
  text: string | null;
  /** What the run is doing after that text: a tool call or reasoning. */
  activity: RunActivity | null;
}

export function runProgress(messages: readonly TaskMessagePayload[] | undefined): RunProgress {
  if (!messages?.length) return { text: null, activity: null };
  const steps = buildSteps(buildTimeline([...messages]));
  const lastText = steps.findLast((s) => s.kind === "text" && s.item.content?.trim());
  const text = lastText && !isCallStep(lastText) ? lastText.item.content!.trim() : null;
  // A call still waiting on its result outranks prose streamed alongside it.
  const current = steps.findLast((s) => isCallStep(s) && !s.result)
    ?? steps.findLast((s) => s.kind !== "text" || s.item.content?.trim());
  let activity: RunActivity | null = null;
  if (current && isCallStep(current)) {
    const detail = redactSecrets(traceToolArgSummary(current.call?.input));
    activity = { kind: "tool", label: [current.tool, detail].filter(Boolean).join(" · ") };
  } else if (current?.kind === "thinking") {
    activity = { kind: "thinking", label: traceEventSummary({ type: "thinking", content: current.item.content }) };
  }
  return { text, activity };
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `HH:mm` on a 24-hour clock. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * `HH:mm` today, the localized "yesterday HH:mm", `MM/DD` within this year,
 * else `YYYY/MM/DD`. `withTime` appends `HH:mm` to the dates too.
 */
export function formatStamp(
  iso: string,
  now: Date,
  yesterday: (time: string) => string,
  { withTime = false }: { withTime?: boolean } = {},
): string {
  const d = new Date(iso);
  const relation = dayRelation(iso, now);
  if (relation === "today") return formatClock(iso);
  if (relation === "yesterday") return yesterday(formatClock(iso));
  const monthDay = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const date = d.getFullYear() === now.getFullYear() ? monthDay : `${d.getFullYear()}/${monthDay}`;
  return withTime ? `${date} ${formatClock(iso)}` : date;
}

/** A two-person chat is named after the other side; a group keeps its own name. */
export function chatDisplayTitle(
  chat: GroupChat,
  userId: string,
  getActorName: (type: string, id: string) => string,
): string {
  const peer = directChatPeer(chat, userId);
  return peer ? getActorName(peer.member_type, peer.member_id) : chat.title;
}

/** The time a chat was last active: its latest message, or its creation. */
export function chatActivityAt(chat: GroupChat): string {
  return chat.last_comment_at ?? chat.created_at;
}

/** Pinned chats first, then the most recently active. */
export function sortChats(chats: GroupChat[]): GroupChat[] {
  return [...chats].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || chatActivityAt(b).localeCompare(chatActivityAt(a)),
  );
}
