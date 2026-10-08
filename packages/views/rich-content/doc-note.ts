import { noteTitle } from "../im/knowledge-utils";

/** A doc an agent created or modified, as announced in a `docs` fence. */
export interface DocNote {
  name: string;
  summary: string;
  /** Path inside a knowledge root, or a full docs path. Forward slashes, ending in `.md`. */
  path: string;
}

/**
 * Reads the JSON body of a `docs` fence. Returns null unless `path` is a
 * relative markdown path, because the docs API cannot open anything else; a
 * missing name falls back to the file name.
 */
export function parseDocNote(body: string): DocNote | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (!isDocNotePath(path)) return null;

  const name = typeof record.name === "string" ? record.name.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.replace(/\s+/g, " ").trim() : "";
  return { name: name || noteTitle(path.split("/").pop() ?? path), summary, path };
}

function isDocNotePath(path: string): boolean {
  if (!/\.md$/i.test(path) || path.startsWith("/") || path.includes("\\") || /^[a-z]:/i.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
