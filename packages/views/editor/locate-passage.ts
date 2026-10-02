import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Finds the document range whose `textBetween(..., "\\n")` equals `passage`.
 * The stored passage is produced that way, including a newline between blocks.
 * When the same words occur more than once, `hint` (the position at selection
 * time) picks the closest occurrence.
 */
export function locatePassage(
  doc: PMNode,
  passage: string,
  hint?: number,
): { from: number; to: number } | null {
  if (!passage) return null;
  const collected = collect(doc);
  const matches: { from: number; to: number }[] = [];
  let at = collected.flat.indexOf(passage);
  while (at !== -1) {
    const from = boundary(collected.pieces, collected.flat.length, at);
    const to = boundary(collected.pieces, collected.flat.length, at + passage.length);
    if (from != null && to != null && from < to && doc.textBetween(from, to, "\n") === passage) {
      matches.push({ from, to });
    }
    at = collected.flat.indexOf(passage, at + 1);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1 || hint == null) return matches[0]!;
  return matches.reduce((best, item) => (Math.abs(item.from - hint) < Math.abs(best.from - hint) ? item : best));
}

interface TextPiece {
  kind: "text";
  flat: number;
  pos: number;
  text: string;
  /** Set for an atom, whose leaf text occupies one position span. */
  atomSize?: number;
}

interface SepPiece {
  kind: "sep";
  flat: number;
  /** Position just before the block that emitted this newline. */
  pos: number;
}

type Piece = TextPiece | SepPiece;

function leafTextOf(node: PMNode): string {
  if (!node.isLeaf || node.isText) return "";
  const spec = node.type.spec.leafText;
  if (spec == null) return "";
  return typeof spec === "function" ? spec(node) : spec;
}

/** Mirrors `Node.textBetween`'s walk so flat offsets map back onto positions. */
function collect(doc: PMNode): { pieces: Piece[]; flat: string } {
  const pieces: Piece[] = [];
  let flat = "";
  let firstBlock = true;
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    const atom = leafTextOf(node);
    if (node.isBlock && ((node.isLeaf && atom.length > 0) || node.isTextblock)) {
      if (firstBlock) firstBlock = false;
      else {
        pieces.push({ kind: "sep", flat: flat.length, pos });
        flat += "\n";
      }
    }
    if (node.isText && node.text) {
      pieces.push({ kind: "text", flat: flat.length, pos, text: node.text });
      flat += node.text;
    } else if (atom) {
      pieces.push({ kind: "text", flat: flat.length, pos, text: atom, atomSize: node.nodeSize });
      flat += atom;
    }
  });
  return { pieces, flat };
}

/** Document position of the boundary before flat index `index` (`flat.length` is the end). */
function boundary(pieces: Piece[], flatLength: number, index: number): number | null {
  if (index < 0 || index > flatLength) return null;
  if (index === flatLength) {
    const last = pieces[pieces.length - 1];
    if (!last) return 0;
    if (last.kind === "text") return last.atomSize != null ? last.pos + last.atomSize : last.pos + last.text.length;
    return last.pos + 1;
  }
  for (const piece of pieces) {
    const len = piece.kind === "sep" ? 1 : piece.text.length;
    if (index < piece.flat || index >= piece.flat + len) continue;
    if (piece.kind === "sep") return Math.max(0, piece.pos - 1);
    if (piece.atomSize != null) return index === piece.flat ? piece.pos : piece.pos + piece.atomSize;
    return piece.pos + (index - piece.flat);
  }
  return null;
}
