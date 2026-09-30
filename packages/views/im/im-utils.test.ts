// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Comment, GroupChat, TaskMessagePayload } from "@multica/core/types";
import {
  THINKING_MESSAGE,
  activeMentionQuery,
  dayRelation,
  encodeMentions,
  latestProgressText,
  resolveComposerMentions,
  needsTimeSeparator,
  plainTextPreview,
  sortChatsByActivity,
  thinkingTaskId,
} from "./im-utils";

describe("plainTextPreview", () => {
  it("keeps mention labels and drops markdown syntax", () => {
    expect(plainTextPreview("**Hi** [@Dev](mention://agent/a-1), see [docs](https://x.test)\n\n> done")).toBe(
      "Hi @Dev, see docs done",
    );
  });
});

describe("encodeMentions", () => {
  it("links each picked name, preferring the longer name", () => {
    const out = encodeMentions("@Dev Ops and @Dev", [
      { name: "Dev", type: "agent", id: "a-1" },
      { name: "Dev Ops", type: "agent", id: "a-2" },
    ]);
    expect(out).toBe("[@Dev Ops](mention://agent/a-2) and [@Dev](mention://agent/a-1)");
  });

  it("leaves text without picked mentions unchanged", () => {
    expect(encodeMentions("email me @ noon", [])).toBe("email me @ noon");
  });
});

describe("resolveComposerMentions", () => {
  const devs = [
    { name: "Dev", type: "agent" as const, id: "a-1" },
    { name: "Dev", type: "agent" as const, id: "a-2" },
  ];

  it("refuses a bare name shared by two members", () => {
    expect(resolveComposerMentions("@Dev take this", [], devs)).toEqual({ ok: false, name: "Dev" });
  });

  it("keeps the member the user picked when names collide", () => {
    expect(resolveComposerMentions("@Dev take this", [devs[1]!], devs)).toEqual({
      ok: true,
      markdown: "[@Dev](mention://agent/a-2) take this",
    });
  });
});

describe("activeMentionQuery", () => {
  it("finds the query being typed after @", () => {
    expect(activeMentionQuery("hey @Res", 8)).toEqual({ start: 4, query: "Res" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores @ inside a word or after a finished token", () => {
    expect(activeMentionQuery("mail@host", 9)).toBeNull();
    expect(activeMentionQuery("@Dev done", 9)).toBeNull();
  });
});

describe("time helpers", () => {
  it("separates messages across days or long gaps", () => {
    expect(needsTimeSeparator(undefined, "2026-09-28T10:00:00Z")).toBe(true);
    expect(needsTimeSeparator("2026-09-28T10:00:00Z", "2026-09-28T10:04:00Z")).toBe(false);
    expect(needsTimeSeparator("2026-09-28T10:00:00Z", "2026-09-28T10:06:00Z")).toBe(true);
  });

  it("names today and yesterday", () => {
    const now = new Date(2026, 8, 28, 12);
    expect(dayRelation(new Date(2026, 8, 28, 9).toISOString(), now)).toBe("today");
    expect(dayRelation(new Date(2026, 8, 27, 23).toISOString(), now)).toBe("yesterday");
    expect(dayRelation(new Date(2026, 8, 20).toISOString(), now)).toBe("other");
  });
});

describe("sortChatsByActivity", () => {
  const chat = (id: string, created: string, last: string | null): GroupChat => ({
    id, workspace_id: "ws", identifier: id, title: id, description: "", creator_type: "member", creator_id: "u",
    created_at: created, last_comment_at: last, last_message: null, members: [], pending_speakers: [],
  });

  it("orders by latest message, falling back to creation time", () => {
    const sorted = sortChatsByActivity([
      chat("old-message", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"),
      chat("new-empty", "2026-09-03T00:00:00Z", null),
      chat("fresh-message", "2026-08-01T00:00:00Z", "2026-09-04T00:00:00Z"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["fresh-message", "new-empty", "old-message"]);
  });
});

describe("thinkingTaskId", () => {
  const comment = (over: Partial<Comment>): Comment =>
    ({ author_type: "agent", content: THINKING_MESSAGE, source_task_id: "t-1", ...over }) as Comment;

  it("returns the run behind an agent's thinking bubble", () => {
    expect(thinkingTaskId(comment({}))).toBe("t-1");
  });

  it("ignores filled replies, people, and bubbles without a run", () => {
    expect(thinkingTaskId(comment({ content: "done" }))).toBeNull();
    expect(thinkingTaskId(comment({ author_type: "member" }))).toBeNull();
    expect(thinkingTaskId(comment({ source_task_id: null }))).toBeNull();
  });
});

describe("latestProgressText", () => {
  const msg = (seq: number, type: TaskMessagePayload["type"], content?: string): TaskMessagePayload => ({
    task_id: "t-1", issue_id: "i-1", seq, type, content,
  });

  it("picks the latest non-empty text, skipping tools and reasoning", () => {
    expect(
      latestProgressText([
        msg(1, "text", "reading the issue"),
        msg(2, "text", "checking the workspace"),
        msg(3, "tool_use"),
        msg(4, "thinking", "internal"),
        msg(5, "text", "  "),
      ]),
    ).toBe("checking the workspace");
  });

  it("is null before the run says anything", () => {
    expect(latestProgressText(undefined)).toBeNull();
    expect(latestProgressText([msg(1, "thinking", "internal")])).toBeNull();
  });
});
