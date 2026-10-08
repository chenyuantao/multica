import type { DocNode } from "@multica/core/types";

/**
 * Splits leading YAML frontmatter off a note. The rich editor would turn the
 * `---` fences into rules, so it only ever sees the body and the block is
 * written back untouched.
 */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  // Blank lines after the closing fence stay with the frontmatter so a save
  // keeps the note's original spacing.
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/.exec(markdown);
  if (!match) return { frontmatter: "", body: markdown };
  return { frontmatter: match[0], body: markdown.slice(match[0].length) };
}

/** Reassembles a note from its frontmatter and the editor's body markdown. */
export function joinFrontmatter(frontmatter: string, body: string): string {
  const text = body.trim() ? `${body.replace(/^\s*\n/, "").replace(/\s+$/, "")}\n` : "";
  if (!frontmatter) return text;
  if (!text) return frontmatter;
  return /\n$/.test(frontmatter) ? frontmatter + text : `${frontmatter}\n${text}`;
}

/**
 * Turns a typed note name into a vault filename, or null when it is not a
 * single visible markdown file name.
 */
export function noteFileName(input: string): string | null {
  const name = input.trim();
  if (!name || name.startsWith(".") || /[\\/\0]/.test(name)) return null;
  const file = /\.md$/i.test(name) ? name : `${name}.md`;
  return file.length > 3 ? file : null;
}

export function parentDir(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** Directory paths from the vault root down to the parent of `path`. */
export function ancestorDirs(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function noteTitle(name: string): string {
  return name.replace(/\.md$/i, "");
}

/** File nodes of a tree in depth-first order, dropping the folders around them. */
export function flattenFiles(nodes: DocNode[]): DocNode[] {
  return nodes.flatMap((node) => (node.type === "file" ? [node] : flattenFiles(node.children)));
}

/** Most recently modified files first; files without a timestamp sort last. */
export function recentFiles(nodes: DocNode[], limit: number): DocNode[] {
  const time = (node: DocNode) => (node.modified_at ? Date.parse(node.modified_at) || 0 : 0);
  return flattenFiles(nodes)
    .sort((a, b) => time(b) - time(a))
    .slice(0, limit);
}

export function findNode(nodes: DocNode[], path: string): DocNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.type === "dir" && path.startsWith(`${node.path}/`)) return findNode(node.children, path);
  }
  return null;
}

/** Top-level knowledge roots, such as a machine share. */
export function knowledgeRoots(nodes: readonly DocNode[]): string[] {
  const roots: string[] = [];
  for (const node of nodes) {
    const root = node.path.split("/")[0];
    if (root && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

function withoutKnowledgeRoot(path: string, roots: ReadonlySet<string>): string {
  const slash = path.indexOf("/");
  if (slash <= 0) return path;
  const head = path.slice(0, slash);
  return roots.has(head) ? path.slice(slash + 1) : path;
}

/**
 * The docs path to open for a card path. An exact tree path wins. Otherwise
 * the knowledge root is ignored, so `Work/a.md` opens `machine/Work/a.md`.
 * Returns null when the tree has no such file.
 */
export function resolveDocPath(cardPath: string, nodes: readonly DocNode[]): string | null {
  const files = flattenFiles(nodes as DocNode[]);
  const exact = files.find((file) => file.path === cardPath);
  if (exact) return exact.path;
  const roots = new Set(knowledgeRoots(nodes));
  if (roots.size === 0) return null;
  const wanted = withoutKnowledgeRoot(cardPath, roots);
  if (!wanted) return null;
  const matches = files.filter((file) => withoutKnowledgeRoot(file.path, roots) === wanted);
  if (matches.length === 0) return null;
  const time = (file: DocNode) => (file.modified_at ? Date.parse(file.modified_at) || 0 : 0);
  matches.sort((a, b) => time(b) - time(a) || a.path.localeCompare(b.path));
  return matches[0].path;
}
