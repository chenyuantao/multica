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

## 发布小红书图文

本机已安装 skillhub 技能 `@indiv-sunny/xhs-note-publisher`（小红书图文发布）。用户要发小红书、做图文笔记、生成封面后发布，或说「复用发布能力」时走本节。问点点仍走上一节。

技能目录：

```bash
SKILL="$HOME/.agents/skills/xhs-note-publisher"
```

同目录还有 `SKILL.md`、`references/publish-recipe.md`、`references/automation.md`。本节只记已调通的用法；对标分析、文案规范和定时队列以技能文档为准。

### 前提

- macOS，`ego-browser` 在 PATH 中。忽略 `[ego-browser:notice]`，不要运行 `ego-browser upgrade`。
- 使用用户已登录的 Ego Lite。发布前用下面的脚本确认创作者平台仍是要使用的账号。本机曾登录的创作者账号是「Mandy 在香港 HK」。
- 未登录时 `handOff()` 把浏览器交还用户，等登录后再继续。不要清 cookie。
- 发布是对外动作。系列首篇发出前，把标题、正文、图片和账号给用户确认，除非用户明示全自动直发。

登录与图文页签检查：

```bash
ego-browser nodejs <<'EOF'
const task = await taskSpace("check xhs publish");
const page = task.page("p1");
await page.goto("https://creator.xiaohongshu.com/publish/publish?source=official", { waitUntil: "load", timeout: 40000 });
await page.waitForTimeout(1500);
const state = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 240) }));
console.log(JSON.stringify(state));
await task.finish({ keep: [] });
EOF
```

已登录时 URL 停在 `creator.xiaohongshu.com/publish/publish`，页面有「上传图文」。跳到登录页则先交还用户。

### 配图

默认用技能脚本渲知识卡片，不要手改生成的 HTML。`cards-data.json` 的 schema 在 `scripts/build-cards.mjs` 头部。风格用 `tech-dark`、`paper-light` 或 `warm-life`。分批渲染时写明 `totalPosts`。

```bash
node "$SKILL/scripts/build-cards.mjs" <series-root>/cards-data.json <series-root>
ego-browser nodejs < "$SKILL/scripts/render-cards.js"
```

第二条读取 `/tmp/xhs-render-list.json`，产出 `1242×1660` PNG。改内容只改 `cards-data.json` 后重跑这两条。

### 发布

在 `<series-root>/manifest.json` 写好队列。发布时只读 manifest，不解析文案文件。每篇包含 `id`、`title`（不超过 20 字）、`body`（不超过 1000 字，文末话题写成 `#话题`）、`images`（相对系列根目录，第 1 张是封面）、`status`（`pending` 或 `published`）。

然后写任务文件并发布：

```bash
cat > /tmp/xhs-publish-task.json <<EOF
{"seriesRoot": "<series-root 绝对路径>", "postId": "01"}
EOF
ego-browser nodejs < "$SKILL/scripts/publish-note.mjs"
```

脚本会检查登录、切到「上传图文」、上传图片、填写标题，并把每个 `#话题` 经联想下拉变成真实话题后再点发布。纯文本 `#` 不算话题。成功时 URL 进入 `/publish/success`，笔记管理页出现该标题；新笔记显示「仅自己可见」是审核期的正常状态。脚本会把结果写回 manifest。

脚本失败时按 `references/publish-recipe.md` 用 Ego Lite 逐步操作。页面上有 3 个同名「上传图文」，用配方里的叶子元素点击，不要用会匹配到多个元素的文本选择器。
