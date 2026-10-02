// @vitest-environment node

import { describe, expect, it } from "vitest";
import { encodeChatHistory } from "./chat-history";
import { chatMessageSearchText, messageMatchesSearch } from "./chat-message-search";

describe("messageMatchesSearch", () => {
  it("matches plain message text case-insensitively", () => {
    expect(messageMatchesSearch("Hello **World**", "world")).toBe(true);
    expect(messageMatchesSearch("Hello **World**", "xyz")).toBe(false);
  });

  it("treats an empty query as a match", () => {
    expect(messageMatchesSearch("anything", "  ")).toBe(true);
    expect(messageMatchesSearch("anything", "")).toBe(true);
  });

  it("matches the trigger on a cancellation notice", () => {
    const content = "```multica-cancelled\n" + JSON.stringify({ trigger: "follow up on deploy" }) + "\n```";
    expect(messageMatchesSearch(content, "deploy")).toBe(true);
    expect(messageMatchesSearch(content, "missing")).toBe(false);
    expect(chatMessageSearchText(content)).toBe("follow up on deploy");
  });

  it("matches nested chat-history body text", () => {
    const content = encodeChatHistory({
      messages: [{ author_name: "Ada", content: "ship the release", created_at: "2026-01-01T00:00:00Z" }],
    });
    expect(messageMatchesSearch(content, "release")).toBe(true);
    expect(messageMatchesSearch(content, "Ada")).toBe(true);
    expect(messageMatchesSearch(content, "missing")).toBe(false);
  });
});
