import { attachmentMarkdown } from "@multica/core/hooks/use-file-upload";
import type { Comment } from "@multica/core/types";
import { plainTextPreview, thinkingTaskId } from "./im-utils";

/** Fence language the thread renders as a chat-history card. */
const FENCE_LANG = "multica-chat-history";

/**
 * Breaks `mention://` so a forwarded snapshot does not enqueue the agents
 * named inside it. Restored when the card is parsed for display.
 */
const MENTION_GAP = "mention:\u200b//";

/** Stay under the server's 64KiB comment limit, with room for encoding. */
export const CHAT_HISTORY_MAX_BYTES = 60 * 1024;

/** Saved message text. The collection row allows a full comment-sized body. */
export const COLLECTION_MAX_BYTES = 64 * 1024;

const PREVIEW_LIMIT = 3;

const IMAGE_MD = /!\[[^\]]*\]\([^)]*\)/g;
const FILE_MD = /!file\[[^\]]*\]\([^)]*\)/g;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?)($|\?)/i;
const FILE_EXT = /\.[a-z0-9]{1,8}($|\?)/i;

export interface ChatHistoryMessage {
  author_name: string;
  content: string;
  created_at: string;
}

export interface ChatHistoryRecord {
  messages: ChatHistoryMessage[];
}

export interface HistoryLabels {
  image: string;
  document: string;
  history: string;
}

export function canForwardMessage(message: Comment): boolean {
  if (message.deleted_at) return false;
  if (message.type !== "comment" || message.author_type === "system") return false;
  return !thinkingTaskId(message);
}

export function isChatHistoryContent(content: string): boolean {
  return content.trimStart().startsWith("```" + FENCE_LANG);
}

export function utf8Size(value: string): number {
  return new TextEncoder().encode(value).length;
}

function shieldMentions(content: string): string {
  return content.replaceAll("mention://", MENTION_GAP);
}

function restoreMentions(content: string): string {
  return content.replaceAll(MENTION_GAP, "mention://");
}

/** Original markdown, plus any attachment the body does not already include. */
export function historyContentOf(message: Pick<Comment, "content" | "attachments">): string {
  if (isChatHistoryContent(message.content)) return message.content;
  const extra = message.attachments
    .map(attachmentMarkdown)
    .filter((markdown) => markdown && !message.content.includes(markdown));
  return [message.content, ...extra].filter(Boolean).join("\n\n");
}

export function encodeChatHistory(record: ChatHistoryRecord): string {
  const shielded: ChatHistoryRecord = {
    messages: record.messages.map((message) => ({
      author_name: message.author_name,
      created_at: message.created_at,
      content: shieldMentions(message.content),
    })),
  };
  return "```" + FENCE_LANG + "\n" + JSON.stringify(shielded) + "\n```";
}

function isHistoryMessage(value: unknown): value is ChatHistoryMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as ChatHistoryMessage;
  return typeof message.author_name === "string" && typeof message.content === "string" && typeof message.created_at === "string";
}

export function parseChatHistory(content: string): ChatHistoryRecord | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```" + FENCE_LANG) || !trimmed.endsWith("```")) return null;
  const nl = trimmed.indexOf("\n");
  if (nl < 0) return null;
  const json = trimmed.slice(nl + 1, trimmed.length - 3).trim();
  try {
    const value = JSON.parse(json) as { messages?: unknown };
    if (!value || !Array.isArray(value.messages)) return null;
    const messages = value.messages.filter(isHistoryMessage).map((message) => ({
      ...message,
      content: restoreMentions(message.content),
    }));
    return messages.length > 0 ? { messages } : null;
  } catch {
    return null;
  }
}

export function historyAuthorNames(messages: readonly { author_name: string }[]): string[] {
  const names: string[] = [];
  for (const message of messages) {
    if (message.author_name && !names.includes(message.author_name)) names.push(message.author_name);
  }
  return names;
}

function isAttachmentUrl(url: string): boolean {
  return /\/api\/attachments\/|\/uploads\//.test(url) || FILE_EXT.test(url);
}

/** Plain text of a saved message, with a chat-history snapshot opened into its messages. */
export function collectionSearchText(content: string): string {
  const nested = parseChatHistory(content);
  if (!nested) return content;
  return nested.messages
    .map((message) => `${message.author_name}\n${collectionSearchText(message.content)}`)
    .join("\n");
}

/** First line of a saved message. A chat-history snapshot uses its first inner line. */
export function collectionListTitle(content: string, labels: HistoryLabels): string {
  const nested = parseChatHistory(content);
  if (nested) {
    for (const message of nested.messages) {
      const line = collectionListTitle(message.content, labels);
      if (line) return line;
    }
    return labels.history;
  }
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    return summarizeMessageContent(line, labels);
  }
  return "";
}

/** One plain line: images and document cards become the short placeholders. */
export function summarizeMessageContent(content: string, labels: HistoryLabels): string {
  if (parseChatHistory(content)) return labels.history;
  const lines = content.split("\n").map((line) => {
    const trimmed = line.trim();
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)) return labels.image;
    if (/^!file\[[^\]]*\]\([^)]*\)$/.test(trimmed)) return labels.document;
    const link = trimmed.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && isAttachmentUrl(link[2] ?? "")) return IMAGE_EXT.test(link[2] ?? "") ? labels.image : labels.document;
    return line;
  });
  const withTokens = lines.join("\n").replace(IMAGE_MD, labels.image).replace(FILE_MD, labels.document);
  return plainTextPreview(withTokens);
}

export function historyPreviewLines(
  messages: readonly ChatHistoryMessage[],
  labels: HistoryLabels,
  limit = PREVIEW_LIMIT,
): { name: string; text: string }[] {
  const lines: { name: string; text: string }[] = [];
  for (const message of messages) {
    const text = summarizeMessageContent(message.content, labels);
    if (!text) continue;
    lines.push({ name: message.author_name, text });
    if (lines.length >= limit) break;
  }
  return lines;
}

/** `nest=0.2` is the third message inside the first nested card. A bad token is the root. */
export function parseHistoryNest(value: string | null): number[] {
  if (!value) return [];
  const indexes: number[] = [];
  for (const part of value.split(".")) {
    if (!/^\d+$/.test(part)) return [];
    indexes.push(Number(part));
  }
  return indexes;
}

/** Walks nested history cards. Missing or non-history steps return null. */
export function historyAt(record: ChatHistoryRecord, indexes: readonly number[]): ChatHistoryRecord | null {
  let current = record;
  for (const index of indexes) {
    const next = parseChatHistory(current.messages[index]?.content ?? "");
    if (!next) return null;
    current = next;
  }
  return current;
}
