// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Comment } from "@multica/core/types";
import {
  canForwardMessage,
  collectionListTitle,
  collectionSearchText,
  encodeChatHistory,
  historyAt,
  historyAuthorNames,
  historyContentOf,
  historyPreviewLines,
  parseChatHistory,
  parseHistoryNest,
  summarizeMessageContent,
  utf8Size,
  CHAT_HISTORY_MAX_BYTES,
  type HistoryLabels,
} from "./chat-history";
import { THINKING_MESSAGE } from "./im-utils";

const labels: HistoryLabels = { image: "[图片]", document: "[文档]", history: "[聊天记录]" };

function comment(partial: Partial<Comment>): Comment {
  return {
    id: "m",
    issue_id: "chat",
    author_type: "member",
    author_id: "user",
    content: "",
    type: "comment",
    parent_id: null,
    reactions: [],
    attachments: [],
    resolved_at: null,
    resolved_by_type: null,
    resolved_by_id: null,
    created_at: "2026-09-30T13:00:00Z",
    updated_at: "2026-09-30T13:00:00Z",
    ...partial,
  };
}

describe("chat history snapshot", () => {
  it("round-trips messages and keeps mention links from enqueueing an agent", () => {
    const content = "ask [@Ada](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)";
    const encoded = encodeChatHistory({
      messages: [{ author_name: "Ada", content, created_at: "2026-09-30T13:00:00Z" }],
    });
    expect(encoded).not.toContain("mention://");
    expect(parseChatHistory(encoded)?.messages[0]?.content).toBe(content);
    expect(utf8Size(encoded)).toBeLessThan(CHAT_HISTORY_MAX_BYTES);
  });

  it("summarizes images, document cards, and nested history", () => {
    expect(summarizeMessageContent("see ![shot](https://cdn.test/a.png) please", labels)).toBe("see [图片] please");
    expect(summarizeMessageContent("!file[spec.pdf](https://cdn.test/spec.pdf)", labels)).toBe("[文档]");
    expect(summarizeMessageContent("[spec.pdf](https://cdn.test/spec.pdf)", labels)).toBe("[文档]");
    expect(summarizeMessageContent("read [the docs](https://example.com/guide)", labels)).toBe("read the docs");
    const nested = encodeChatHistory({
      messages: [{ author_name: "Ada", content: "inside", created_at: "2026-09-30T13:00:00Z" }],
    });
    expect(summarizeMessageContent(nested, labels)).toBe("[聊天记录]");
  });

  it("previews the first few non-empty lines and the people who wrote them", () => {
    const lines = historyPreviewLines(
      [
        { author_name: "Ada", content: "  ", created_at: "t" },
        { author_name: "Bo", content: "one", created_at: "t" },
        { author_name: "Ada", content: "two", created_at: "t" },
        { author_name: "Cy", content: "three", created_at: "t" },
        { author_name: "Di", content: "four", created_at: "t" },
      ],
      labels,
    );
    expect(lines).toEqual([
      { name: "Bo", text: "one" },
      { name: "Ada", text: "two" },
      { name: "Cy", text: "three" },
    ]);
    expect(historyAuthorNames([{ author_name: "Ada" }, { author_name: "Ada" }, { author_name: "Bo" }])).toEqual([
      "Ada",
      "Bo",
    ]);
  });

  it("keeps an attachment that the message body does not already show", () => {
    const attachment = {
      id: "att-1",
      filename: "spec.pdf",
      content_type: "application/pdf",
      markdown_url: "https://cdn.test/spec.pdf",
      url: "https://cdn.test/spec.pdf",
    } as Comment["attachments"][number];
    const withFile = historyContentOf(comment({ content: "notes", attachments: [attachment] }));
    expect(withFile).toBe("notes\n\n[spec.pdf](https://cdn.test/spec.pdf)");
    expect(historyContentOf(comment({ content: withFile, attachments: [attachment] }))).toBe(withFile);
  });

  it("refuses a thinking bubble and allows an ordinary message", () => {
    expect(canForwardMessage(comment({ content: "hello" }))).toBe(true);
    expect(
      canForwardMessage(
        comment({ content: THINKING_MESSAGE, author_type: "agent", author_id: "agent-1", source_task_id: "task-1" }),
      ),
    ).toBe(false);
    expect(canForwardMessage(comment({ type: "system", author_type: "system", content: "joined" }))).toBe(false);
  });

  it("uses the first line, and the first inner line of a chat history", () => {
    expect(collectionListTitle("hello world\nsecond", labels)).toBe("hello world");
    expect(collectionListTitle("![shot](https://cdn.test/a.png)\ncaption", labels)).toBe("[图片]");
    const card = encodeChatHistory({
      messages: [
        { author_name: "Ada", content: "first saved line\nmore", created_at: "2026-01-01T00:00:00Z" },
        { author_name: "Bo", content: "later", created_at: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(collectionListTitle(card, labels)).toBe("first saved line");
    expect(collectionSearchText(card)).toContain("first saved line\nmore");
    expect(collectionSearchText(card)).toContain("Ada");
    expect(collectionSearchText(card)).not.toContain("multica-chat-history");
  });

  it("ignores a comment that is not a history card", () => {
    expect(parseChatHistory("hello ```multica-chat-history\n{}\n```")).toBeNull();
  });

  it("walks a nest path into a nested card", () => {
    const nested = encodeChatHistory({ messages: [{ author_name: "Bo", content: "inner", created_at: "2026-01-01T00:00:00Z" }] });
    const root = encodeChatHistory({
      messages: [
        { author_name: "Ada", content: "outer", created_at: "2026-01-01T00:00:00Z" },
        { author_name: "Ada", content: nested, created_at: "2026-01-01T00:00:00Z" },
      ],
    });
    const record = parseChatHistory(root);
    expect(record && historyAt(record, parseHistoryNest("1"))?.messages[0]?.content).toBe("inner");
    expect(record && historyAt(record, parseHistoryNest("0"))).toBeNull();
    expect(parseHistoryNest("1.x")).toEqual([]);
  });
});
