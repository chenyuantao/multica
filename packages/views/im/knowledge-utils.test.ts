// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DocNode } from "@multica/core/types";
import {
  ancestorDirs,
  findNode,
  flattenFiles,
  joinFrontmatter,
  noteFileName,
  parentDir,
  recentFiles,
  resolveDocPath,
  splitFrontmatter,
} from "./knowledge-utils";

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
    const file: DocNode = { name: "c.md", path: "a/b/c.md", type: "file", child_count: 0, modified_at: null, children: [], match: "", snippet: "", hits: 0 };
    const tree: DocNode[] = [
      { ...file, name: "a", path: "a", type: "dir", children: [{ ...file, name: "b", path: "a/b", type: "dir", children: [file] }] },
    ];
    expect(findNode(tree, "a/b/c.md")).toBe(file);
    expect(findNode(tree, "a/x.md")).toBeNull();
  });
});

describe("flattenFiles / recentFiles", () => {
  const file = (path: string, modified_at: string | null): DocNode => ({
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
    child_count: 0,
    modified_at,
    children: [],
    match: "",
    snippet: "",
    hits: 0,
  });
  const dir = (path: string, children: DocNode[]): DocNode => ({
    ...file(path, null),
    type: "dir",
    child_count: children.length,
    children,
  });
  const tree = [
    dir("a", [dir("a/b", [file("a/b/old.md", "2026-01-01T00:00:00Z")]), file("a/new.md", "2026-03-01T00:00:00Z")]),
    file("none.md", null),
    file("mid.md", "2026-02-01T00:00:00+08:00"),
  ];

  it("drops folders and keeps tree order", () => {
    expect(flattenFiles(tree).map((n) => n.path)).toEqual(["a/b/old.md", "a/new.md", "none.md", "mid.md"]);
  });

  it("orders by modification time, undated last, and caps the list", () => {
    expect(recentFiles(tree, 10).map((n) => n.path)).toEqual(["a/new.md", "mid.md", "a/b/old.md", "none.md"]);
    expect(recentFiles(tree, 2).map((n) => n.path)).toEqual(["a/new.md", "mid.md"]);
  });
});

describe("resolveDocPath", () => {
  const file = (path: string, modified_at: string | null = null): DocNode => ({
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
    child_count: 0,
    modified_at,
    children: [],
    match: "",
    snippet: "",
    hits: 0,
  });
  const dir = (path: string, children: DocNode[]): DocNode => ({
    ...file(path),
    type: "dir",
    child_count: children.length,
    children,
  });
  const tree = [
    dir("mbp", [file("mbp/Work/周报.md", "2026-01-01T00:00:00Z")]),
    dir("other", [file("other/Work/周报.md", "2026-04-01T00:00:00Z")]),
  ];

  it("keeps an exact path", () => {
    expect(resolveDocPath("mbp/Work/周报.md", tree)).toBe("mbp/Work/周报.md");
  });

  it("ignores the knowledge root when the card omitted it", () => {
    expect(resolveDocPath("Work/周报.md", tree)).toBe("other/Work/周报.md");
  });

  it("ignores a different root prefix on the card", () => {
    const moved = [
      dir("mbp", [file("mbp/Other.md")]),
      dir("other", [file("other/Work/周报.md")]),
    ];
    expect(resolveDocPath("mbp/Work/周报.md", moved)).toBe("other/Work/周报.md");
  });

  it("returns null when nothing matches", () => {
    expect(resolveDocPath("Work/没有.md", tree)).toBeNull();
    expect(resolveDocPath("Work/周报.md", [])).toBeNull();
  });
});
