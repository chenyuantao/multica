import { parseCancelledNotice } from "./cancelled-notice";
import { isChatHistoryContent, parseChatHistory } from "./chat-history";
import { plainTextPreview } from "./im-utils";

/**
 * Plain text used to match a chat message against an in-thread search query.
 * Special system payloads contribute their visible trigger / nested body text.
 */
export function chatMessageSearchText(content: string): string {
  const cancelled = parseCancelledNotice(content);
  if (cancelled) return cancelled.trigger;

  if (isChatHistoryContent(content)) {
    const record = parseChatHistory(content);
    if (!record) return "";
    return record.messages
      .map((m) => `${m.author_name} ${plainTextPreview(m.content)}`)
      .join("\n");
  }

  return plainTextPreview(content);
}

/** Case-insensitive substring match. An empty/whitespace query matches everything. */
export function messageMatchesSearch(content: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return chatMessageSearchText(content).toLowerCase().includes(needle);
}
