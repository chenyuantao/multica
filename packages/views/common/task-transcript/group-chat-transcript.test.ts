// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatTranscriptXml, readGroupChatTranscript } from "./group-chat-transcript";

const TRANSCRIPT =
  '<group_chat>\n<msg index="1" sender="Ada" role="member">hello</msg>\n' +
  '<msg index="2" sender="Ops" role="agent" trigger="true">\n<ref sender="Ada" role="member">hello</ref>\nline one\nline two\n</msg>\n' +
  "<desc>\nEach msg element is one message.\n</desc>\n</group_chat>";

describe("readGroupChatTranscript", () => {
  it("reads the field from the stored claim payload", () => {
    const payload = JSON.stringify({ id: "t", group_chat_transcript: TRANSCRIPT }, null, 2);
    expect(readGroupChatTranscript(payload)).toBe(TRANSCRIPT);
  });

  it("still reads a whole field from a clipped payload", () => {
    const payload = JSON.stringify({ group_chat_transcript: TRANSCRIPT, trailing: "x".repeat(50) }, null, 2);
    expect(readGroupChatTranscript(payload.slice(0, -20))).toBe(TRANSCRIPT);
  });

  it("returns nothing when the run carried no transcript", () => {
    expect(readGroupChatTranscript("")).toBe("");
    expect(readGroupChatTranscript('{"id":"t"}')).toBe("");
    expect(readGroupChatTranscript("not json")).toBe("");
  });
});

describe("formatTranscriptXml", () => {
  it("indents by nesting and keeps single-line text inline", () => {
    expect(formatTranscriptXml(TRANSCRIPT)).toBe(
      [
        "<group_chat>",
        '  <msg index="1" sender="Ada" role="member">hello</msg>',
        '  <msg index="2" sender="Ops" role="agent" trigger="true">',
        '    <ref sender="Ada" role="member">hello</ref>',
        "    line one",
        "    line two",
        "  </msg>",
        "  <desc>Each msg element is one message.</desc>",
        "</group_chat>",
      ].join("\n"),
    );
  });

  it("formats sibling blocks and self-closing tags", () => {
    expect(formatTranscriptXml('<group_chat/>\n\n<ask_ai_context id="m"><chat><agent name="A"/></chat></ask_ai_context>')).toBe(
      ["<group_chat/>", '<ask_ai_context id="m">', "  <chat>", '    <agent name="A"/>', "  </chat>", "</ask_ai_context>"].join("\n"),
    );
  });
});
