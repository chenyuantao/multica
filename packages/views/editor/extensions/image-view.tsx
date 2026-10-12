"use client";

/**
 * ImageView — Tiptap NodeView for the image node.
 *
 * Thin wrapper around the unified `<Attachment>` dispatcher. All rendering
 * (figure, hover toolbar, lightbox/preview) lives there. The NodeView only
 * forwards Tiptap's editor-context hints (editable, selected, deleteNode).
 */

import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Attachment } from "../attachment";
import { useDocAssetObjectUrl } from "../hooks/use-doc-asset-url";
import { parseDocAssetSrc } from "../utils/doc-asset";

function ImageView({ node, editor, selected, deleteNode }: NodeViewProps) {
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const assetPath = parseDocAssetSrc(src)?.path ?? null;
  const asset = useDocAssetObjectUrl(assetPath);
  const url = assetPath ? asset.url : src;
  const uploading = Boolean(node.attrs.uploading) || (assetPath != null && asset.pending);
  const width = (node.attrs.width as number | null) ?? undefined;
  const height = (node.attrs.height as number | null) ?? undefined;

  // <Attachment> emits its own .image-node wrapper, so the NodeViewWrapper
  // stays unclassed — no double image-node.
  return (
    <NodeViewWrapper>
      <Attachment
        attachment={{
          kind: "url",
          url,
          filename: alt,
          uploading,
          // Intrinsic dimensions reserve the <img> box pre-decode (no shift).
          width,
          height,
          // Tiptap image node is structurally an image regardless of alt.
          forceKind: "image",
        }}
        editable={editor.isEditable}
        selected={selected}
        onDelete={() => deleteNode()}
      />
    </NodeViewWrapper>
  );
}

export { ImageView };
