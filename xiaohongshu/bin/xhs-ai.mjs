#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { CHAT_URL, RESULT_MARK, buildAskScript, buildWaitLoginScript } from "../src/ego-script.mjs";
import { renderQr } from "../src/qr-terminal.mjs";

const DEFAULT_QR_PATH = path.join(os.tmpdir(), "xhs-ai-login-qr.png");
const EXIT_LOGIN_REQUIRED = 3;

const HELP = `xhs-ai — 通过 ego lite 浏览器向小红书 AI「点点」（${CHAT_URL}）提问，输出完整回复（Markdown）和原始对话链接

用法:
  xhs-ai <问题...>
  xhs-ai ask <问题...>
  echo "问题" | xhs-ai
  xhs-ai login                     检查登录态，失效时输出二维码并等待扫码

前置条件:
  已安装 ego lite 并完成引导（提供 ego-browser 命令）。

登录态失效时会输出二维码链接、二维码图片路径，并在终端绘制二维码；
扫码成功后自动继续提问。加 --no-wait 则输出二维码后立即以退出码 ${EXIT_LOGIN_REQUIRED} 结束，
配合 --json 可把 {code:"login_required", qrUrl, qrImage} 转发给用户扫码。

选项:
  -c, --conversation <id>   在已有会话中继续追问（id 见 --json 输出的 conversationId）
  --json                    以 JSON 输出结果
  --timeout <秒>            等待回复的最长时间（默认 180）
  --idle <秒>               未检测到完成标记时，回复多少秒不变视为结束（默认 15）
  --no-wait                 登录态失效时不等待扫码，输出二维码后直接退出
  --login-timeout <秒>      等待扫码登录的最长时间（默认 300）
  --qr-path <file>          二维码图片保存路径（默认 ${DEFAULT_QR_PATH}）
  --keep-open               完成后在 ego lite 中保留该页面
  --space <name>            ego TaskSpace 名称（默认 xhs-ai）
  -q, --quiet               不输出进度日志
  -h, --help                显示帮助
`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    conversation: { type: "string", short: "c" },
    json: { type: "boolean", default: false },
    timeout: { type: "string", default: "180" },
    idle: { type: "string", default: "15" },
    "no-wait": { type: "boolean", default: false },
    "login-timeout": { type: "string", default: "300" },
    "qr-path": { type: "string", default: DEFAULT_QR_PATH },
    "keep-open": { type: "boolean", default: false },
    space: { type: "string", default: "xhs-ai" },
    quiet: { type: "boolean", short: "q", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const qrPath = path.resolve(opts["qr-path"]);

const log = (msg) => {
  if (!opts.quiet) process.stderr.write(`[xhs-ai] ${msg}\n`);
};

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Runs a script through `ego-browser nodejs` and returns its result line.
 * ego reports script output on stderr, and only after the script exits.
 */
function runEgoScript(script) {
  const env = { ...process.env, PATH: `${path.join(os.homedir(), ".local", "bin")}${path.delimiter}${process.env.PATH ?? ""}` };
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.EGO_BROWSER_BIN ?? "ego-browser", ["nodejs"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (err) => {
      reject(
        err.code === "ENOENT"
          ? new Error("未找到 ego-browser 命令，请先安装 ego lite（https://lite.ego.app/）并完成引导")
          : err,
      );
    });
    child.on("close", (code) => {
      if (output.includes("[ego-browser:notice]")) log("ego lite 有可用更新，可运行 ego-browser upgrade");
      const line = output.split("\n").find((l) => l.startsWith(RESULT_MARK));
      if (line) resolve(JSON.parse(line.slice(RESULT_MARK.length)));
      else reject(new Error(`ego-browser 执行失败（exit ${code}）:\n${output.trim()}`));
    });
    child.stdin.end(script);
  });
}

class CliError extends Error {
  constructor(result, exitCode = 1) {
    super(result.message);
    this.result = result;
    this.exitCode = exitCode;
  }
}

function showQr({ qrUrl, qrImage, qrMatrix }) {
  const lines = ["请用小红书 App 扫码登录："];
  if (qrUrl) lines.push(`  二维码链接: ${qrUrl}`);
  if (qrImage) lines.push(`  二维码图片: ${qrImage}`);
  process.stderr.write(`[xhs-ai] ${lines.join("\n")}\n`);
  if (qrMatrix && process.stderr.isTTY) process.stderr.write(renderQr(qrMatrix));
}

/** Polls ego in short rounds so QR refreshes and scan progress reach the user promptly. */
async function waitForLogin(qr) {
  let lastQrSig = qr.qrSig;
  let scannedNotified = false;
  const deadline = Date.now() + Number(opts["login-timeout"]) * 1000;
  while (Date.now() < deadline) {
    const result = await runEgoScript(
      buildWaitLoginScript({
        spaceName: opts.space,
        qrPath,
        lastQrSig,
        scannedNotified,
        windowMs: Math.min(45_000, Math.max(5_000, deadline - Date.now())),
      }),
    );
    if (!result.ok) throw new CliError(result);
    if (result.state === "logged_in") {
      log("登录成功");
      return;
    }
    if (result.state === "qr") {
      log("二维码已刷新");
      showQr(result);
      lastQrSig = result.qrSig;
      scannedNotified = false;
    } else if (result.state === "scanned") {
      log("已扫码，请在手机上确认登录");
      scannedNotified = true;
    }
  }
  throw new CliError({ code: "login_timeout", message: "等待扫码登录超时" }, EXIT_LOGIN_REQUIRED);
}

/** Runs the ask script, handling an expired login by showing the QR code and waiting for the scan. */
async function runWithLogin(params) {
  const script = () => buildAskScript({ ...params, spaceName: opts.space, qrPath });
  let result = await runEgoScript(script());
  if (result.ok || result.code !== "login_required") return result;

  showQr(result);
  if (opts["no-wait"]) throw new CliError(result, EXIT_LOGIN_REQUIRED);
  log(`等待扫码登录（最长 ${opts["login-timeout"]} 秒）…`);
  await waitForLogin(result);
  if (params.question != null) log("重新发送问题…");
  result = await runEgoScript(script());
  if (!result.ok && result.code === "login_required") throw new CliError(result, EXIT_LOGIN_REQUIRED);
  return result;
}

async function main() {
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  if (positionals[0] === "login") {
    const result = await runWithLogin({ question: null });
    if (!result.ok) throw new CliError(result);
    if (opts.json) process.stdout.write(`${JSON.stringify({ loggedIn: true })}\n`);
    else log("小红书已登录");
    return;
  }

  const args = positionals[0] === "ask" ? positionals.slice(1) : positionals;
  const question = (args.join(" ") || (await readStdin())).trim();
  if (!question) {
    process.stderr.write(HELP);
    process.exitCode = 2;
    return;
  }

  log(opts.conversation ? `在会话 ${opts.conversation} 中提问…` : "正在向点点提问，等待完整回复…");
  const result = await runWithLogin({
    question,
    conversationId: opts.conversation,
    timeoutMs: Number(opts.timeout) * 1000,
    idleMs: Number(opts.idle) * 1000,
    keepOpen: opts["keep-open"],
  });
  if (!result.ok) throw new CliError(result);
  if (!result.complete) log("未检测到完成标记，回复可能不完整");

  const { ok, ...payload } = result;
  process.stdout.write(opts.json ? `${JSON.stringify(payload, null, 2)}\n` : `${result.answer}\n\n原始对话：${result.url}\n`);
  if (!opts.json && result.conversationId) log(`会话 ID: ${result.conversationId}（用 -c 继续追问）`);
}

main().catch((err) => {
  if (err instanceof CliError) {
    if (opts.json) {
      const { ok, qrMatrix, qrSig, ...payload } = err.result;
      process.stdout.write(`${JSON.stringify({ ok: false, ...payload }, null, 2)}\n`);
    }
    process.stderr.write(`[xhs-ai] 错误: ${err.message}\n`);
    process.exit(err.exitCode);
  }
  process.stderr.write(`[xhs-ai] 错误: ${err?.message ?? err}\n`);
  process.exit(1);
});
