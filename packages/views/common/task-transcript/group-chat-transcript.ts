/**
 * The group-chat history a run was handed, read back out of the stored claim
 * payload (the pretty-printed JSON the server recorded at dispatch).
 */

const FIELD_PATTERN = /"group_chat_transcript"\s*:\s*("(?:[^"\\]|\\.)*")/;

export function readGroupChatTranscript(payload: string): string {
  if (!payload) return "";
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>).group_chat_transcript;
      return typeof value === "string" ? value : "";
    }
    return "";
  } catch {
    // A payload clipped at the storage cap is not valid JSON, but the field
    // may still be whole inside it.
    const match = FIELD_PATTERN.exec(payload);
    if (!match?.[1]) return "";
    try {
      const value: unknown = JSON.parse(match[1]);
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }
}

interface XmlElement {
  type: "element";
  name: string;
  open: string;
  selfClosing: boolean;
  closed: boolean;
  children: XmlNode[];
}

interface XmlText {
  type: "text";
  text: string;
}

type XmlNode = XmlElement | XmlText;

const INDENT = "  ";

function tagName(tag: string): string {
  return /^<\/?\s*([^\s/>]+)/.exec(tag)?.[1] ?? "";
}

function parse(xml: string): XmlNode[] {
  const root: XmlNode[] = [];
  const stack: XmlElement[] = [];
  const append = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    (parent ? parent.children : root).push(node);
  };

  for (const token of xml.split(/(<[^<>]+>)/)) {
    if (!token) continue;
    if (!token.startsWith("<") || !token.endsWith(">")) {
      const text = token.trim();
      if (text) append({ type: "text", text });
      continue;
    }
    if (token.startsWith("</")) {
      const name = tagName(token);
      const at = stack.map((el) => el.name).lastIndexOf(name);
      if (at < 0) {
        append({ type: "text", text: token });
        continue;
      }
      stack[at]!.closed = true;
      stack.length = at;
      continue;
    }
    const selfClosing = token.endsWith("/>") || token.startsWith("<?") || token.startsWith("<!");
    const el: XmlElement = {
      type: "element",
      name: tagName(token),
      open: token,
      selfClosing,
      closed: selfClosing,
      children: [],
    };
    append(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

function print(node: XmlNode, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  if (node.type === "text") {
    for (const line of node.text.split("\n")) out.push(pad + line);
    return;
  }
  if (node.selfClosing) {
    out.push(pad + node.open);
    return;
  }
  const close = node.closed ? `</${node.name}>` : "";
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (node.children.length === 0) {
    out.push(pad + node.open + close);
    return;
  }
  if (only?.type === "text" && !only.text.includes("\n")) {
    out.push(pad + node.open + only.text + close);
    return;
  }
  out.push(pad + node.open);
  for (const child of node.children) print(child, depth + 1, out);
  if (close) out.push(pad + close);
}

/** Re-indents XML by nesting depth; text content is kept verbatim. */
export function formatTranscriptXml(xml: string): string {
  const out: string[] = [];
  for (const node of parse(xml)) print(node, 0, out);
  return out.join("\n");
}
