export const RESULT_MARK = "__XHS_COMMENTS_RESULT__";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const emit = (P, result) => console.log(P.mark + JSON.stringify(result));

/** Login wall vs search results. Runs in the Page. */
function pageReady() {
  const visible = (el) => (el && el.checkVisibility ? el.checkVisibility() : Boolean(el));
  const qr = [...document.querySelectorAll("img.qrcode-img")].some(visible);
  const phone = [...document.querySelectorAll("input")].some(
    (el) => visible(el) && /手机号/.test(el.getAttribute("placeholder") || ""),
  );
  const blocked = location.pathname.startsWith("/website-login/error")
    ? new URL(location.href).searchParams.get("error_msg") || "unknown"
    : null;
  return {
    blocked,
    loginForm: qr || phone,
    notes: document.querySelectorAll("a.cover").length,
    url: location.href,
  };
}

/** Visible search cards. Runs in the Page. */
function listNotes() {
  const clean = (s) => (s || "").replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
  const seen = new Set();
  const notes = [];
  for (const cover of document.querySelectorAll("a.cover")) {
    const href = cover.getAttribute("href") || "";
    const id = href.match(/\/(?:search_result|explore)\/([0-9a-f]+)/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const card = cover.closest("section") || cover.parentElement;
    notes.push({
      id,
      href,
      title: clean(card?.querySelector("a.title")?.innerText),
      author: clean(card?.querySelector("a.author")?.innerText),
    });
  }
  return notes;
}

/** Open note modal. Runs in the Page. */
function readOpenNote() {
  const clean = (s) => (s || "").replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
  const title = clean(document.querySelector("#detail-title, .note-content .title")?.innerText);
  const body = clean(document.querySelector("#detail-desc, .note-content .desc")?.innerText).slice(0, 500);
  const seen = new Set();
  const comments = [];
  for (const item of document.querySelectorAll(".comment-item, .parent-comment")) {
    const text = clean(item.querySelector(".content, .note-text, .comment-text")?.innerText);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const likesRaw = clean(item.querySelector(".like-wrapper .count, .like .count")?.innerText);
    const likes = Number.parseInt(likesRaw, 10);
    comments.push({
      author: clean(item.querySelector(".author .name, .name")?.innerText),
      text,
      likes: Number.isFinite(likes) ? likes : 0,
    });
  }
  const panel = document.querySelector(".comments-el, .comments-container, .interaction-container");
  return {
    title,
    body,
    url: location.href,
    comments,
    panelFound: Boolean(panel || document.querySelector(".comment-item")),
    panelText: clean(panel?.innerText).slice(0, 2500),
  };
}

async function waitReady(page) {
  let last = null;
  for (const deadline = Date.now() + 20_000; Date.now() < deadline; await sleep(400)) {
    last = await page.evaluate(pageReady);
    if (last.blocked || last.loginForm || last.notes > 0) return last;
  }
  return last || { blocked: null, loginForm: false, notes: 0, url: await page.url() };
}

async function openNote(page, index) {
  try {
    await page.click(`css=a.cover >> nth=${index}`, { label: "open search note" });
  } catch {
    const clicked = await page.evaluate((i) => {
      const el = document.querySelectorAll("a.cover")[i];
      el?.click();
      return Boolean(el);
    }, index);
    if (!clicked) return false;
  }
  try {
    await page.waitForFunction(
      () => Boolean(document.querySelector("#detail-title, .note-content .title, .comment-item, .comments-el")),
      undefined,
      { timeout: 12_000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function scrollComments(page) {
  for (let step = 0; step < 3; step++) {
    await page.evaluate(() => {
      const scroller = document.querySelector(".note-scroller, .comments-container, .interaction-container");
      if (scroller) scroller.scrollTop += scroller.clientHeight || 700;
    });
    await sleep(500);
  }
}

async function closeNote(page) {
  await page.keyboard.press("Escape");
  await sleep(400);
  const stillOpen = await page.evaluate(
    () => Boolean(document.querySelector("#detail-title, .comments-el, .note-detail-mask")),
  );
  if (!stillOpen) return;
  await page.evaluate(() => {
    const close = document.querySelector(".close-circle, .close-box, .note-detail-mask .close");
    close?.click();
  });
  await sleep(400);
}

async function collectKeyword(page, keyword, P) {
  const target = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const ready = await waitReady(page);
  if (ready.blocked) return { blocked: ready.blocked };
  if (ready.loginForm && ready.notes === 0) return { loginRequired: true, url: ready.url };
  if (!ready.notes) return { keyword, searchUrl: target, notes: [], error: "no_notes" };

  const cards = (await page.evaluate(listNotes)).slice(0, P.notesPerKeyword);
  const notes = [];
  for (let i = 0; i < cards.length; i++) {
    const opened = await openNote(page, i);
    if (!opened) {
      notes.push({ ...cards[i], comments: [], error: "detail_timeout" });
      await closeNote(page);
      continue;
    }
    await scrollComments(page);
    const detail = await page.evaluate(readOpenNote);
    const comments = (detail.comments || []).slice(0, P.commentsPerNote);
    notes.push({
      id: cards[i].id,
      title: detail.title || cards[i].title,
      author: cards[i].author,
      href: cards[i].href,
      url: detail.url,
      body: detail.body,
      comments,
      panelFound: detail.panelFound,
      panelText: comments.length ? undefined : detail.panelText,
    });
    await closeNote(page);
    await sleep(600);
  }
  return { keyword, searchUrl: target, notes };
}

async function collectMain(P) {
  const task = await taskSpace(P.spaceName);
  const page = task.page("p1");
  const groups = [];
  for (const keyword of P.keywords) {
    const group = await collectKeyword(page, keyword, P);
    if (group.blocked) {
      emit(P, { ok: false, code: "blocked", message: `小红书安全限制：${group.blocked}` });
      return;
    }
    if (group.loginRequired) {
      emit(P, {
        ok: false,
        code: "login_required",
        message: "小红书登录态已失效。先运行 node xiaohongshu/bin/xhs-ai.mjs login，扫码后再采集评论。",
        url: group.url,
      });
      return;
    }
    groups.push(group);
  }
  emit(P, { ok: true, groups });
  await task.finish({ keep: P.keepOpen ? ["p1"] : [] });
}

const HELPERS = {
  sleep,
  emit,
  pageReady,
  listNotes,
  readOpenNote,
  waitReady,
  openNote,
  scrollComments,
  closeNote,
  collectKeyword,
};

export function buildCommentsScript({ keywords, notesPerKeyword, commentsPerNote, spaceName, keepOpen }) {
  const helpers = Object.entries(HELPERS)
    .map(([name, fn]) => `const ${name} = ${fn.toString()};`)
    .join("\n");
  const params = {
    mark: RESULT_MARK,
    keywords,
    notesPerKeyword,
    commentsPerNote,
    spaceName,
    keepOpen,
  };
  return `${helpers}\nconst run = ${collectMain.toString()};\nawait run(${JSON.stringify(params)});\n`;
}
