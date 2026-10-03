export type DocNodeType = "dir" | "file";

/** One visible entry of the Obsidian vault. Only markdown files are listed. */
export interface DocNode {
  name: string;
  /** Vault-relative path with forward slashes. */
  path: string;
  type: DocNodeType;
  /** Direct visible children of a directory; 0 for files. */
  child_count: number;
  modified_at: string | null;
  children: DocNode[];
  /** Search hits only: "title", "content" or "both". */
  match: string;
  snippet: string;
  /** Search hits only: keyword occurrences across title and body. */
  hits: number;
}

export interface DocSearchResult {
  query: string;
  nodes: DocNode[];
  truncated: boolean;
}

/** Full text of one markdown note. `revision` guards concurrent writes. */
export interface DocFile {
  path: string;
  name: string;
  content: string;
  modified_at: string;
  revision: string;
}

export interface SaveDocFileRequest {
  path: string;
  content: string;
  base_revision: string;
  /** Text the edit started from, so the server can merge a concurrent change. */
  base_content: string;
}

export interface CreateDocFileRequest {
  path: string;
  content: string;
}

/** Move a note or folder into `dest`. An empty dest is the vault root. */
export interface MoveDocRequest {
  path: string;
  dest: string;
}

export interface DocMoveResult {
  from: string;
  path: string;
  name: string;
  type: DocNodeType;
}
