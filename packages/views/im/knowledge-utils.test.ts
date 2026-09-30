// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DocNode } from "@multica/core/types";
import { ancestorDirs, findNode, joinFrontmatter, noteFileName, parentDir, splitFrontmatter } from "./knowledge-utils";

describe("splitFrontmatter / joinFrontmatter", () => {
  it("round-trips a note with frontmatter", () => {
    const note = "---\ntitle: 计划\ntags: [q3]\n---\n\n# 计划\n\n正文\n";
    const { frontmatter, body } = splitFrontmatter(note);
    expect(frontmatter).toBe("---\ntitle: 计划\ntags: [q3]\n---\n\n");
    expect(body).toBe("# 计划\n\n正文\n");
    expect(joinFrontmatter(frontmatter, "# 计划\n\n正文")).toBe(note);
  });

  it("keeps a note without a gap after the fence byte-identical", () => {
    const note = "---\na: 1\n---\n# a\n";
    const { frontmatter } = splitFrontmatter(note);
    expect(joinFrontmatter(frontmatter, "# a")).toBe(note);
  });

  it("leaves notes without frontmatter alone", () => {
    expect(splitFrontmatter("# a\n---\nb")).toEqual({ frontmatter: "", body: "# a\n---\nb" });
    expect(joinFrontmatter("", "# a")).toBe("# a\n");
    expect(joinFrontmatter("", "  ")).toBe("");
  });

  it("keeps frontmatter when the body is emptied", () => {
    expect(joinFrontmatter("---\na: 1\n---", "")).toBe("---\na: 1\n---");
    expect(joinFrontmatter("---\na: 1\n---", "b")).toBe("---\na: 1\n---\nb\n");
  });
});

describe("noteFileName", () => {
  it("appends the markdown extension", () => {
    expect(noteFileName(" 周报 ")).toBe("周报.md");
    expect(noteFileName("plan.MD")).toBe("plan.MD");
  });

  it("rejects names that are not one visible file", () => {
    for (const name of ["", "  ", ".hidden", "a/b", "a\\b", ".md"]) expect(noteFileName(name)).toBeNull();
  });
});

describe("paths", () => {
  it("derives parents and ancestors", () => {
    expect(parentDir("a/b/c.md")).toBe("a/b");
    expect(parentDir("c.md")).toBe("");
    expect(ancestorDirs("a/b/c.md")).toEqual(["a", "a/b"]);
    expect(ancestorDirs("c.md")).toEqual([]);
  });

  it("finds nested nodes", () => {
    const file: DocNode = { name: "c.md", path: "a/b/c.md", type: "file", child_count: 0, modified_at: null, children: [], match: "", snippet: "" };
    const tree: DocNode[] = [
      { ...file, name: "a", path: "a", type: "dir", children: [{ ...file, name: "b", path: "a/b", type: "dir", children: [file] }] },
    ];
    expect(findNode(tree, "a/b/c.md")).toBe(file);
    expect(findNode(tree, "a/x.md")).toBeNull();
  });
});
