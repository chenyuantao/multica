# xhs-ai

CLI that asks Xiaohongshu AI chat (点点) through the ego lite browser.

## Answering "xiaohongshu 问：…" / "小红书 问：…"

Run from the repository root:

```bash
node xiaohongshu/bin/xhs-ai.mjs "<问题>"
```

stdout is the complete Xiaohongshu reply as its original Markdown, followed by a `原始对话：<url>` line.

- Return stdout verbatim as the whole answer: every paragraph of the reply plus the `原始对话` link, keeping the Markdown as-is (do not wrap it in a code block).
- Do not paraphrase, summarize, reorder, reformat, translate, or fact-check the reply, and do not add commentary before or after it.
- If stderr says the reply may be incomplete (`回复可能不完整`), still return stdout verbatim and add that one warning.
- Follow-ups in the same conversation: pass `-c <conversationId>`; the id is printed on stderr.
- Exit code 3 means login is required: give the user the QR link and image path from stderr, wait for the scan, then rerun. For other failures, report the error message; do not answer the question yourself.
