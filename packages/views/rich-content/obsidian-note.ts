import { noteTitle } from "../im/knowledge-utils";

/** An Obsidian note an agent created or modified, as announced in an `obsidian` fence. */
export interface ObsidianNote {
  name: string;
  summary: string;
  /** Vault-relative, forward slashes, ending in `.md`. */
  path: string;
}

/**
 * Reads the JSON body of an `obsidian` fence. Returns null unless `path` is a
 * vault-relative markdown path, because the docs API cannot open anything
 * else; a missing name falls back to the file name.
 */
export function parseObsidianNote(body: string): ObsidianNote | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (!isVaultNotePath(path)) return null;

  const name = typeof record.name === "string" ? record.name.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.replace(/\s+/g, " ").trim() : "";
  return { name: name || noteTitle(path.split("/").pop() ?? path), summary, path };
}

function isVaultNotePath(path: string): boolean {
  if (!/\.md$/i.test(path) || path.startsWith("/") || path.includes("\\") || /^[a-z]:/i.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
