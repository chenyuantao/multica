import { stripMarkdown } from "./strip-markdown";

const MAX_CORPUS = 2000;

/** Recent chat text passed to ASR as biasing context. Keeps the tail. */
export function buildSpeechCorpus(input: {
  agentName?: string | null;
  snippets?: string[];
}): string {
  const parts: string[] = [];
  const name = input.agentName?.trim();
  if (name) parts.push(name);
  for (const snippet of input.snippets ?? []) {
    const clean = stripMarkdown(snippet).replace(/\s+/g, " ").trim();
    if (clean) parts.push(clean);
  }
  let text = parts.join("\n");
  if (text.length > MAX_CORPUS) text = text.slice(text.length - MAX_CORPUS);
  return text;
}
