// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../test/i18n";
import { encodeChatHistory } from "./chat-history";
import { ChatHistoryTranscript } from "./chat-history-card";

vi.mock("../rich-content", () => ({
  RichContent: ({ content }: { content: string }) => <p>{content}</p>,
}));

describe("ChatHistoryTranscript", () => {
  it("opens a nested card through the page callback", () => {
    const nested = encodeChatHistory({
      messages: [{ author_name: "Bo", content: "inner", created_at: "2026-01-02T00:00:00Z" }],
    });
    const onOpenNested = vi.fn();
    renderWithI18n(
      <ChatHistoryTranscript
        record={{
          messages: [
            { author_name: "Ada", content: "outer", created_at: "2026-01-01T00:00:00Z" },
            { author_name: "Ada", content: nested, created_at: "2026-01-01T00:00:00Z" },
          ],
        }}
        onOpenNested={onOpenNested}
      />,
    );
    expect(screen.getByText("outer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Chat History for Bo/ }));
    expect(onOpenNested).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
