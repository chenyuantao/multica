import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { parseDocAssetSrc } from "../editor/utils/doc-asset";
import { ImageExtension } from "../editor/extensions";
import { preprocessMarkdown } from "../editor/utils/preprocess";
import { collapseVaultImages, expandVaultImages, resolveVaultImage } from "./knowledge-images";

const NOTE = "mbp/日记/退休.md";
const WIKI = "![[Images/20261012_退休大潮_图01.png]]";
const SOURCE = `前文\n\n${WIKI}\n\n后文`;

let editors: Editor[] = [];

function makeEditor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      ImageExtension,
      Markdown.configure({ indentation: { style: "space", size: 3 } }),
    ],
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.innerHTML = "";
});

describe("resolveVaultImage", () => {
  it("joins a wiki path to the machine root, not the note folder", () => {
    expect(resolveVaultImage(NOTE, "Images/20261012_退休大潮_图01.png")).toBe(
      "mbp/Images/20261012_退休大潮_图01.png",
    );
    expect(resolveVaultImage(NOTE, "Images/20261012_退休大潮_图01.png|300")).toBe(
      "mbp/Images/20261012_退休大潮_图01.png",
    );
  });

  it("resolves ./ and ../ from the note and refuses to leave the machine", () => {
    expect(resolveVaultImage(NOTE, "./shot.png")).toBe("mbp/日记/shot.png");
    expect(resolveVaultImage(NOTE, "../Images/shot.png")).toBe("mbp/Images/shot.png");
    expect(resolveVaultImage(NOTE, "../../secret.png")).toBeNull();
    expect(resolveVaultImage(NOTE, "/Images/shot.png")).toBeNull();
    expect(resolveVaultImage(NOTE, "https://example.com/a.png")).toBeNull();
    expect(resolveVaultImage("note.md", "Images/a.png")).toBeNull();
  });
});

describe("expandVaultImages", () => {
  it("turns a wiki image into an asset request and restores it", () => {
    const expanded = expandVaultImages(NOTE, SOURCE);
    const ref = parseDocAssetSrc(expanded.match(/doc-asset:[A-Za-z0-9_-]+/)?.[0] ?? "");
    expect(ref).toEqual({
      path: "mbp/Images/20261012_退休大潮_图01.png",
      raw: "Images/20261012_退休大潮_图01.png",
      kind: "wiki",
    });
    expect(expanded).not.toContain("日记/Images");

    const processed = preprocessMarkdown(expanded, { cdnDomain: "" });
    const editor = makeEditor();
    editor.commands.setContent(processed, { contentType: "markdown" });
    const saved = collapseVaultImages(editor.getMarkdown());
    expect(saved).toContain(WIKI);
    expect(saved).not.toContain("doc-asset:");
    expect(saved).toContain("前文");
    expect(saved).toContain("后文");
  });

  it("keeps a sized wiki embed and a root-relative markdown image", () => {
    const sized = "![[Images/图01.png|300]]";
    expect(collapseVaultImages(expandVaultImages(NOTE, sized))).toBe(sized);

    const md = "![图](Images/图01.png)";
    const expanded = expandVaultImages(NOTE, md);
    expect(parseDocAssetSrc(expanded.match(/doc-asset:[A-Za-z0-9_-]+/)?.[0] ?? "")?.path).toBe(
      "mbp/Images/图01.png",
    );
    expect(collapseVaultImages(expanded)).toBe(md);
  });

  it("leaves note links, remote images, and code samples as text", () => {
    const source = [
      "![[退休]]",
      "![远程](https://example.com/a.png)",
      "```",
      WIKI,
      "```",
      "`![[Images/a.png]]`",
    ].join("\n");
    expect(expandVaultImages(NOTE, source)).toBe(source);
  });
});
