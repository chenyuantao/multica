#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { RESULT_MARK, buildCommentsScript } from "../src/comments-script.mjs";

const HELP = `xhs-comments — 用已登录的 Ego Lite 读取小红书网页搜索结果里公开可见的笔记评论

用法:
  xhs-comments <关键词...>
  xhs-comments --notes 3 --comments 12 个人养老金 税优健康险

只打开搜索页和笔记浮层，读取当前可见评论。不调用未公开接口。
登录失效时先运行: node xiaohongshu/bin/xhs-ai.mjs login

选项:
  --notes <n>       每个关键词打开的笔记数（默认 3，最大 8）
  --comments <n>    每篇笔记保留的评论数（默认 12，最大 40）
  --json            输出原始 JSON
  --keep-open       完成后保留浏览器页面
  --space <name>    Ego TaskSpace 名称（默认 xhs-comments-cli）
  -q, --quiet       不输出进度
  -h, --help        显示帮助
`;

const CONCERNS = [
  { label: "能省多少税、税率档", re: /税|抵扣|税率|个税/ },
  { label: "锁定期、能不能提前取", re: /锁定|提前|退休才能|取出来|领取|年限/ },
  { label: "收益低、会不会亏", re: /收益|利率|亏|理财|跑输|划算/ },
  { label: "怎么开户、怎么操作", re: /怎么开|如何开|流程|银行|操作|在哪|APP|app/ },
  { label: "和商业保险、年金怎么选", re: /商业|年金|增额|保险|税优/ },
  { label: "医保、报销、医疗", re: /医保|医疗|报销|住院/ },
  { label: "缴费年限、断缴、补缴", re: /断缴|补缴|15年|20年|缴费/ },
  { label: "退休地、异地转移", re: /异地|转移|退休地|落户/ },
];

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    notes: { type: "string", default: "3" },
    comments: { type: "string", default: "12" },
    json: { type: "boolean", default: false },
    "keep-open": { type: "boolean", default: false },
    space: { type: "string", default: "xhs-comments-cli" },
    quiet: { type: "boolean", short: "q", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const log = (msg) => {
  if (!opts.quiet) process.stderr.write(`[xhs-comments] ${msg}\n`);
};

function clamp(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}

function runEgoScript(script) {
  const env = {
    ...process.env,
    PATH: `${path.join(os.homedir(), ".local", "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.EGO_BROWSER_BIN ?? "ego-browser", ["nodejs"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (err) => {
      reject(err.code === "ENOENT" ? new Error("未找到 ego-browser 命令，请先安装 ego lite") : err);
    });
    child.on("close", (code) => {
      const line = output.split("\n").find((l) => l.startsWith(RESULT_MARK));
      if (line) resolve(JSON.parse(line.slice(RESULT_MARK.length)));
      else reject(new Error(`ego-browser 执行失败（exit ${code}）:\n${output.trim()}`));
    });
    child.stdin.end(script);
  });
}

function allComments(groups) {
  const rows = [];
  for (const group of groups) {
    for (const note of group.notes || []) {
      for (const comment of note.comments || []) {
        if (!comment.text) continue;
        rows.push({ ...comment, keyword: group.keyword, title: note.title, url: note.url });
      }
    }
  }
  return rows;
}

function renderMarkdown(groups) {
  const comments = allComments(groups);
  const lines = [];
  const hits = CONCERNS.map((item) => ({
    label: item.label,
    rows: comments.filter((row) => item.re.test(row.text)),
  })).filter((item) => item.rows.length > 0);

  lines.push(`共读取 ${comments.length} 条可见评论。`);
  lines.push("");
  if (hits.length) {
    lines.push("## 评论里反复出现的关切");
    lines.push("");
    const used = new Set();
    for (const hit of hits.sort((a, b) => b.rows.length - a.rows.length)) {
      const ranked = [...hit.rows].sort((a, b) => b.likes - a.likes);
      const sample = ranked.find((row) => !used.has(row.text)) || ranked[0];
      if (sample) used.add(sample.text);
      lines.push(`- **${hit.label}**（${hit.rows.length} 条）${sample?.text ? `：${sample.text}` : ""}`);
    }
    lines.push("");
  }

  const unmatched = comments.filter((row) => !CONCERNS.some((item) => item.re.test(row.text)));
  const top = [...comments].sort((a, b) => b.likes - a.likes).slice(0, 8);
  if (top.length) {
    lines.push("## 点赞较高的评论");
    lines.push("");
    for (const row of top) {
      lines.push(`- ${row.likes ? `(${row.likes}) ` : ""}${row.text}`);
      if (row.title) lines.push(`  - 笔记：${row.title}`);
    }
    lines.push("");
  }
  if (unmatched.length && hits.length) {
    lines.push(`另有 ${unmatched.length} 条评论没有落进上面的关切词。`);
    lines.push("");
  }

  for (const group of groups) {
    lines.push(`## 关键词：${group.keyword}`);
    lines.push("");
    if (group.error) lines.push(`搜索结果：${group.error}`);
    for (const note of group.notes || []) {
      lines.push(`### ${note.title || note.id || "未命名笔记"}`);
      lines.push("");
      if (note.url) lines.push(note.url);
      if (note.error) lines.push(`打开失败：${note.error}`);
      if (note.body) lines.push(note.body);
      if (note.comments?.length) {
        for (const comment of note.comments) {
          lines.push(`- ${comment.likes ? `(${comment.likes}) ` : ""}${comment.text}`);
        }
      } else if (note.panelText) {
        lines.push("评论选择器没有命中，笔记浮层原文：");
        lines.push("");
        lines.push(note.panelText);
      } else {
        lines.push("没有读到评论。");
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  const keywords = positionals.map((item) => item.trim()).filter(Boolean);
  if (!keywords.length) {
    process.stderr.write(HELP);
    process.exitCode = 2;
    return;
  }

  const notesPerKeyword = clamp(opts.notes, 3, 8);
  const commentsPerNote = clamp(opts.comments, 12, 40);
  log(`搜索 ${keywords.join("、")}，每个词 ${notesPerKeyword} 篇笔记…`);
  const result = await runEgoScript(
    buildCommentsScript({
      keywords,
      notesPerKeyword,
      commentsPerNote,
      spaceName: opts.space,
      keepOpen: opts["keep-open"],
    }),
  );
  if (!result.ok) {
    process.stderr.write(`[xhs-comments] 错误: ${result.message}\n`);
    process.exitCode = result.code === "login_required" ? 3 : 1;
    return;
  }
  process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result.groups));
}

main().catch((err) => {
  process.stderr.write(`[xhs-comments] 错误: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
