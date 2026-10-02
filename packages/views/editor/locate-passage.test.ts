// @vitest-environment node

import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { locatePassage } from "./locate-passage";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    code_block: { content: "text*", group: "block", code: true },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph block*", defining: true },
    text: { group: "inline" },
  },
});

function docOf(...blocks: ReturnType<Schema["node"]>) {
  return schema.node("doc", null, blocks);
}

function paragraph(text: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

describe("locatePassage", () => {
  it("selects a passage inside one block and across the following block", () => {
    const doc = docOf(paragraph("hello world"), paragraph("周五发布"));
    const flat = doc.textBetween(0, doc.content.size, "\n");
    expect(flat).toBe("hello world\n周五发布");

    const inside = locatePassage(doc, "world");
    expect(inside && doc.textBetween(inside.from, inside.to, "\n")).toBe("world");

    const across = locatePassage(doc, "world\n周五");
    expect(across && doc.textBetween(across.from, across.to, "\n")).toBe("world\n周五");
  });

  it("keeps a newline that lives inside a code block", () => {
    const doc = docOf(schema.node("code_block", null, [schema.text("line1\nline2")]));
    const range = locatePassage(doc, "line1\nline2");
    expect(range && doc.textBetween(range.from, range.to, "\n")).toBe("line1\nline2");
  });

  it("picks the occurrence nearest the original selection when the words repeat", () => {
    const doc = docOf(paragraph("周五发布"), paragraph("中间"), paragraph("周五发布"));
    const first = locatePassage(doc, "周五发布");
    const second = locatePassage(doc, "周五发布", 20);
    expect(first && second).toBeTruthy();
    expect(second!.from).toBeGreaterThan(first!.from);
    expect(doc.textBetween(second!.from, second!.to, "\n")).toBe("周五发布");
  });

  it("returns null when the passage is gone", () => {
    expect(locatePassage(docOf(paragraph("hello")), "missing")).toBeNull();
  });
});
