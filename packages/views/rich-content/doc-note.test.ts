// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseDocNote } from "./doc-note";

describe("parseDocNote", () => {
  it("reads name, summary and a path inside the knowledge root", () => {
    expect(
      parseDocNote('{"name":"周报","summary":"本周  完成\\n发布","path":"Work/周报.md"}'),
    ).toEqual({ name: "周报", summary: "本周 完成 发布", path: "Work/周报.md" });
  });

  it("falls back to the file name and an empty summary", () => {
    expect(parseDocNote('{"path":" Notes/Plan.md "}')).toEqual({
      name: "Plan",
      summary: "",
      path: "Notes/Plan.md",
    });
  });

  it.each([
    ["malformed JSON", '{"path":"a.md"'],
    ["a non-object", '["a.md"]'],
    ["a missing path", '{"name":"a"}'],
    ["an absolute path", '{"path":"/Users/me/vault/a.md"}'],
    ["a Windows path", '{"path":"C:/vault/a.md"}'],
    ["backslashes", '{"path":"Notes\\\\a.md"}'],
    ["a parent segment", '{"path":"../a.md"}'],
    ["an empty segment", '{"path":"Notes//a.md"}'],
    ["a non-markdown file", '{"path":"Notes/a.png"}'],
  ])("rejects %s", (_, body) => {
    expect(parseDocNote(body)).toBeNull();
  });
});
