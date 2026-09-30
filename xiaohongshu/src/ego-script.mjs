export const CHAT_URL = "https://www.xiaohongshu.com/ai_chat";
export const RESULT_MARK = "__XHS_AI_RESULT__";

// Everything below runs inside `ego-browser nodejs` (ego's own Node.js
// runtime with globals such as taskSpace). Functions are serialized with
// toString(), so each one may only reference other helpers listed in
// HELPERS, ego globals, and its arguments.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const emit = (P, result) => console.log(P.mark + JSON.stringify(result));

/** Reads login-related page state; runs in the Page. */
function pageLoginState() {
  const unref = (v) => (v && typeof v === "object" && "__v_isRef" in v ? v.value : v);
  const visible = (sel) => [...document.querySelectorAll(sel)].find((el) => el.checkVisibility()) ?? null;
  const url = new URL(location.href);
  const state = window.__INITIAL_STATE__;
  const user = unref(state?.user);
  const qrData = unref(unref(state?.login)?.qrData);
  const qrImg = visible("img.qrcode-img");
  return {
    onChat: url.pathname.startsWith("/ai_chat"),
    blocked: url.pathname.startsWith("/website-login/error") ? url.searchParams.get("error_msg") || "unknown" : null,
    loggedIn: unref(user?.loggedIn) === true,
    loginForm: Boolean(visible('input[placeholder*="手机号"]') || qrImg),
    chatReady: Boolean(visible('textarea[name="aiSearchTextarea"]')),
    rounds: document.querySelectorAll(".round-item").length,
    qrSig: qrImg ? qrImg.src.slice(-80) : null,
    qrStatus: unref(qrData?.status) ?? null,
    qrExpired: /二维码已(过期|失效)/.test(document.querySelector(".qrcode, .code-area")?.parentElement?.innerText ?? ""),
  };
}

/**
 * Decodes the visible login QR code and samples its module grid so the CLI
 * can render it in a terminal; runs in the Page.
 */
async function pageReadQr() {
  const img = [...document.querySelectorAll("img.qrcode-img")].find((el) => el.checkVisibility());
  if (!img || !img.complete || !img.naturalWidth) return null;

  let url = null;
  try {
    const codes = await new BarcodeDetector({ formats: ["qr_code"] }).detect(img);
    url = codes[0]?.rawValue ?? null;
  } catch {}

  let matrix = null;
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const dark = (x, y) => {
      const i = (Math.floor(y) * w + Math.floor(x)) * 4;
      return px[i + 3] > 128 && px[i] + px[i + 1] + px[i + 2] < 384;
    };
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!dark(x, y)) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    // The top-left finder pattern's first row is 7 dark modules wide.
    let run = 0;
    while (minX + run <= maxX && dark(minX + run, minY + 1)) run++;
    const size = maxX - minX + 1;
    const n = 4 * Math.max(1, Math.round((size / (run / 7) - 17) / 4)) + 17;
    const mod = size / n;
    matrix = [];
    for (let r = 0; r < n; r++) {
      let row = "";
      for (let c = 0; c < n; c++) row += dark(minX + (c + 0.5) * mod, minY + (r + 0.5) * mod) ? "1" : "0";
      matrix.push(row);
    }
  } catch {}

  return { src: img.src, sig: img.src.slice(-80), url, matrix };
}

/** Makes sure the login QR code is on screen, then saves and decodes it. */
async function captureQr(page, P) {
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; await sleep(700)) {
    const state = await page.evaluate(pageLoginState);
    if (!state.qrSig) {
      // Login modal dismissed: reopen it from the sidebar login button.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("#login-btn, .login-btn, button")].find(
          (el) => el.checkVisibility() && el.innerText.trim() === "登录",
        );
        btn?.click();
      });
      continue;
    }
    const qr = await page.evaluate(pageReadQr);
    if (!qr) continue;
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.dirname(P.qrPath), { recursive: true });
    if (qr.src.startsWith("data:")) {
      await fs.writeFile(P.qrPath, Buffer.from(qr.src.split(",")[1], "base64"));
    } else {
      await page.fetch(qr.src, { saveAs: P.qrPath });
    }
    return { qrUrl: qr.url, qrImage: P.qrPath, qrMatrix: qr.matrix, qrSig: qr.sig };
  }
  return null;
}

/**
 * Loads the chat page and classifies it. Returns "ready", or emits the
 * login QR / error and returns null.
 */
async function openChat(page, P, task) {
  const target = P.conversationId ? `${P.chatUrl}?conversationId=${encodeURIComponent(P.conversationId)}` : P.chatUrl;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // The chat shell renders before the auth check redirects, so require the
  // ready state to hold across two polls.
  let readyPolls = 0;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; await sleep(800)) {
    const state = await page.evaluate(pageLoginState);
    if (state.blocked) {
      emit(P, { ok: false, code: "blocked", message: `小红书安全限制：${state.blocked}` });
      return null;
    }
    if (!state.onChat || state.loginForm) {
      const qr = await captureQr(page, P);
      emit(P, {
        ok: false,
        code: "login_required",
        message: "小红书登录态已失效，请用小红书 App 扫码登录",
        spaceId: task.spaceId,
        ...qr,
      });
      return null;
    }
    readyPolls = state.chatReady ? readyPolls + 1 : 0;
    if (readyPolls >= 2) return state;
  }
  emit(P, { ok: false, code: "input_not_found", message: "等待聊天输入框超时" });
  return null;
}

/** Entry: ask a question (or only verify login when P.question is null). */
async function askMain(P) {
  const INPUT = 'textarea[name="aiSearchTextarea"]';
  const task = await taskSpace(P.spaceName);
  const page = task.page("p1");
  const fail = (code, message) => emit(P, { ok: false, code, message });

  const state = await openChat(page, P, task);
  if (!state) return;
  if (P.question == null) {
    emit(P, { ok: true, loggedIn: true });
    await task.finish({ keep: [] });
    return;
  }

  const readReply = () =>
    page.evaluate(() => {
      const rounds = document.querySelectorAll(".round-item");
      const last = rounds[rounds.length - 1];
      const message = last?.querySelector(".ai-message");
      const markdown = message?.querySelector(".xhs-ai-md-container");
      const clean = (s) => (s ?? "").replace(/\u200b/g, "").replace(/\n{3,}/g, "\n\n").trim();
      // Each rendered block keeps its markdown source in data-original-text.
      const source = [...(markdown?.querySelectorAll(".markdown-block") ?? [])]
        .filter((b) => !b.parentElement.closest(".markdown-block"))
        .map((b) => b.dataset.originalText ?? "")
        .join("\n\n");
      return {
        rounds: rounds.length,
        question: clean(last?.querySelector(".user-message__text")?.innerText),
        text: clean(source) || clean(markdown?.innerText),
        fallbackText: clean(message?.innerText),
        source: clean(message?.querySelector(".progress-text")?.innerText),
        finished: Boolean(message?.classList.contains("ai-message-finished")),
      };
    });

  await page.click(INPUT, { label: "focus chat input" });
  await page.keyboard.insertText(P.question);
  await sleep(300);
  await page.keyboard.press("Enter");

  const waitForNewRound = async (ms) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(300)) {
      if ((await readReply()).rounds > state.rounds) return true;
    }
    return false;
  };
  if (!(await waitForNewRound(8_000))) {
    await page.click(".submit-button-wrapper", { label: "send question" }).catch(() => {});
    if (!(await waitForNewRound(8_000))) return fail("send_failed", "问题未能发送");
  }

  let reply;
  let lastText = "";
  let lastChange = Date.now();
  for (const deadline = Date.now() + P.timeoutMs; Date.now() < deadline; await sleep(500)) {
    reply = await readReply();
    if (reply.text !== lastText) {
      lastText = reply.text;
      lastChange = Date.now();
    }
    if (reply.finished) break;
    if (reply.text && Date.now() - lastChange >= P.idleMs) break;
  }

  const answer = reply?.text || (reply?.finished ? reply.fallbackText : "");
  if (!answer) return fail("timeout", "等待 AI 回复超时");

  const url = await page.url();
  emit(P, {
    ok: true,
    complete: Boolean(reply.finished),
    question: reply.question || P.question,
    answer,
    source: reply.source || undefined,
    conversationId: new URL(url).searchParams.get("conversationId") ?? undefined,
    url,
  });
  await task.finish({ keep: P.keepOpen ? ["p1"] : [] });
}

/**
 * Entry: watch the login page for up to P.windowMs and return as soon as
 * something the user should see changes (scanned, new QR, logged in).
 */
async function waitLoginMain(P) {
  const task = await taskSpace(P.spaceName);
  const page = task.page("p1");
  if (!(await page.url()).includes("xiaohongshu.com")) {
    await page.goto(P.chatUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(1_500);
  }

  for (const deadline = Date.now() + P.windowMs; Date.now() < deadline; await sleep(1_000)) {
    const state = await page.evaluate(pageLoginState).catch(() => null);
    if (!state) continue; // page is navigating after a successful scan
    if (state.blocked) return emit(P, { ok: false, code: "blocked", message: `小红书安全限制：${state.blocked}` });

    if (state.loggedIn || (!state.loginForm && !state.qrSig)) {
      await page.goto(P.chatUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(2_000);
      const after = await page.evaluate(pageLoginState);
      if (after.onChat && !after.loginForm) return emit(P, { ok: true, state: "logged_in" });
      const qr = await captureQr(page, P);
      if (qr) return emit(P, { ok: true, state: "qr", ...qr });
      continue;
    }

    if (state.qrExpired) {
      await page.evaluate(() => {
        const area = document.querySelector(".qrcode, .code-area")?.parentElement;
        const refresh = [...(area?.querySelectorAll("*") ?? [])].find(
          (el) => el.checkVisibility() && /刷新|重新获取/.test(el.innerText ?? "") && el.children.length === 0,
        );
        (refresh ?? document.querySelector(".qrcode"))?.click();
      });
      await sleep(1_500);
    }

    if (state.qrSig && state.qrSig !== P.lastQrSig && !state.qrExpired) {
      const qr = await captureQr(page, P);
      if (qr) return emit(P, { ok: true, state: "qr", ...qr });
    }
    if (state.qrStatus === "scanned" && !P.scannedNotified) return emit(P, { ok: true, state: "scanned" });
  }
  emit(P, { ok: true, state: "pending" });
}

const HELPERS = { sleep, emit, pageLoginState, pageReadQr, captureQr, openChat };

function buildScript(entry, params) {
  const helpers = Object.entries(HELPERS)
    .map(([name, fn]) => `const ${name} = ${fn.toString()};`)
    .join("\n");
  const P = { mark: RESULT_MARK, chatUrl: CHAT_URL, ...params };
  return `${helpers}\nconst run = ${entry.toString()};\nawait run(${JSON.stringify(P)});\n`;
}

export function buildAskScript({ question, conversationId, spaceName, timeoutMs, idleMs, keepOpen, qrPath }) {
  return buildScript(askMain, {
    question: question ?? null,
    conversationId: conversationId ?? null,
    spaceName,
    timeoutMs,
    idleMs,
    keepOpen,
    qrPath,
  });
}

export function buildWaitLoginScript({ spaceName, qrPath, lastQrSig, scannedNotified, windowMs }) {
  return buildScript(waitLoginMain, { spaceName, qrPath, lastQrSig: lastQrSig ?? null, scannedNotified, windowMs });
}
