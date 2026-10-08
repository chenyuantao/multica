import type { DocNodeType } from "@multica/core/types";
import { parentDir } from "./knowledge-utils";

/** How long the pointer must rest on a collapsed folder before it springs open. */
export const FOLDER_EXPAND_DELAY_MS = 200;

export interface DragNode {
  path: string;
  type: DocNodeType;
}

/**
 * Directory a drop on `target` moves into. A file receives the drop into its
 * parent. Null when the entry is already there, the drop would put a folder
 * inside itself, or it would cross to another machine.
 */
export function dropDirectory(item: DragNode, target: DragNode): string | null {
  const dest = target.type === "dir" ? target.path : parentDir(target.path);
  return canDrop(item, dest) ? dest : null;
}

const machineOf = (path: string) => path.split("/")[0];

/**
 * Every path starts with the machine that shares it. A machine root is not
 * movable, and an entry only moves within its own machine.
 */
export function canDrop(item: DragNode, dest: string): boolean {
  if (!item.path.includes("/") || !dest) return false;
  if (machineOf(dest) !== machineOf(item.path)) return false;
  if (parentDir(item.path) === dest) return false;
  if (item.type === "dir" && (dest === item.path || dest.startsWith(`${item.path}/`))) return false;
  return true;
}

/**
 * Collapsed folder the pointer is resting on. Hovering a file does not open
 * anything: its parent is already expanded, or the file would not be visible.
 */
export function springOpenFolder(item: DragNode, target: DragNode, open: boolean): string | null {
  if (target.type !== "dir" || open) return null;
  if (item.type === "dir" && (target.path === item.path || target.path.startsWith(`${item.path}/`))) return null;
  return target.path;
}
