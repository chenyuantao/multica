// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  decodeDocExcerptPayload,
  docExcerptPlain,
  encodeDocExcerpt,
  encodeDocExcerptPayload,
  splitDocExcerpts,
} from "./doc-excerpt";
import { resolveComposerBody } from "./im-utils";

const weekly = { name: "本周周报", path: "notes/weekly.md", text: "周五发布" };

describe("doc excerpts", () => {
  it("round-trips a passage and keeps a second one beside it", () => {
    const first = encodeDocExcerpt(weekly);
    const second = encodeDocExcerpt({ name: "计划", path: "notes/plan.md", text: "a < b & c" });
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    const message = `请改 ${first} 和 ${second}`;
    expect(splitDocExcerpts(message).map((part) => (part.kind === "excerpt" ? part.excerpt.text : part.text))).toEqual([
      "请改 ",
      "周五发布",
      " 和 ",
      "a < b & c",
    ]);
    expect(docExcerptPlain(message)).toBe("请改 周五发布 和 a < b & c");
    expect(decodeDocExcerptPayload(encodeDocExcerptPayload(weekly) ?? "")).toEqual(weekly);
  });

  it("drops an empty passage and caps a huge one", () => {
    expect(encodeDocExcerpt({ name: " ", path: "notes/a.md", text: "hi" })).toBeNull();
    const text = "字".repeat(5000);
    const excerpt = decodeDocExcerptPayload(encodeDocExcerptPayload({ name: "笔记", path: "a.md", text }) ?? "");
    expect(excerpt?.text).toHaveLength(4000);
  });

  it("does not turn an @ inside a passage into a mention", () => {
    const token = encodeDocExcerpt({ name: "笔记", path: "a.md", text: "ask @Dev" });
    const dev = { name: "Dev", type: "agent" as const, id: "a-1" };
    expect(resolveComposerBody(`${token} @Dev`, [dev], [dev])).toEqual({
      ok: true,
      markdown: `${token} [@Dev](mention://agent/a-1)`,
    });
  });
});
