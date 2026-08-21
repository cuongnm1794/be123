const BAR_ID = "ncn-export-bar";
const XPATH_STORAGE_KEY = "lastXPath";

/** Không gắn UI lên LMS; không click/scroll bằng script — chỉ đọc DOM + server click */
const PAGE_READ_ONLY = true;
window.NCN_PAGE_READ_ONLY = true;

const DOM_INTERACTION_BLOCKED = new Set([
  "XPATH_CLICK",
  "AUTO_ANSWER",
  "AUTO_ANSWER_PICK_ONLY",
  "LOOP_TOGGLE",
  "SCROLL_LOOP_TOGGLE",
  "CLICK_NEXT_TEST",
]);

const DOM_INTERACTION_ERROR =
  "Đã tắt thao tác script trên trang — chỉ đọc DOM + click server (dùng popup).";

function broadcastPageStatus(text, opts = {}) {
  chrome.runtime
    .sendMessage({
      type: "PAGE_STATUS",
      text: text || "",
      error: opts.error === true,
      lookup: opts.lookup === true,
    })
    .catch(() => {});
}

const XPATH_PRESETS = {
  question:
    "//div[contains(@class,'question-content')]//span[contains(@class,'content-display')]",
  answer1:
    "(//div[contains(@class,'mc-text-question__radio-answer')])[1]//input[@type='radio']",
  next: "//button[contains(@class,'ant-btn')][.//span[normalize-space()='Tiếp']]",
};

const loopState = {
  running: false,
  stopRequested: false,
  count: 0,
  loopBtn: null,
  statusEl: null,
};

const scrollLoopState = {
  running: false,
  stopRequested: false,
  count: 0,
  loopBtn: null,
  statusEl: null,
};

const serverLoopState = {
  running: false,
  stopRequested: false,
  count: 0,
  loopBtn: null,
  statusEl: null,
};

const simulationLoopState = {
  running: false,
  stopRequested: false,
  count: 0,
};

const AUTO_LOOKUP_INTERVAL_MS = 1_000;

const autoLookupState = {
  enabled: true,
  lastKey: null,
  busy: false,
  pollTimer: null,
  statusEl: null,
};

function randomMs(minMs, maxMs) {
  const min = Math.min(minMs, maxMs);
  const max = Math.max(minMs, maxMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function checkStopFlag() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "FETCH_CHECK_STOP" });
    return res?.stop === true;
  } catch {
    return false;
  }
}

async function waitWithCountdown(delayMs, onProgress, label, shouldStop) {
  const total = Math.max(0, Number(delayMs) || 0);
  if (total === 0) return;

  const end = Date.now() + total;
  while (Date.now() < end) {
    if (shouldStop?.()) return;
    const left = Math.ceil((end - Date.now()) / 1000);
    if (onProgress) onProgress(`${label} (${left}s)…`);
    await sleep(Math.min(1000, Math.max(0, end - Date.now())));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showXPathUsed(statusEl, xpath, extra = "") {
  const line = xpath ? `XPath: ${xpath}` : "";
  statusEl.textContent = extra ? `${extra}\n${line}` : line;
  statusEl.classList.toggle("ncn-has-xpath", Boolean(xpath));
}

function broadcastLoopProgress(text) {
  chrome.runtime
    .sendMessage({
      type: "LOOP_PROGRESS",
      running: loopState.running,
      count: loopState.count,
      text,
    })
    .catch(() => {});
}

function updateLoopButton() {
  const btn = loopState.loopBtn;
  if (!btn) return;
  if (loopState.running) {
    btn.textContent = "Dừng loop";
    btn.classList.add("ncn-loop-stop");
  } else {
    btn.textContent = "Chạy loop";
    btn.classList.remove("ncn-loop-stop");
  }
}

async function loadAutoSettings() {
  return chrome.storage.sync.get({
    answerApiUrl: "http://localhost:3003/api/answer",
    insertApiUrl: "http://localhost:3003/api/insert",
    autoPickFirstOnNotFound: true,
    defaultAnswerPosition: 0,
    answerDelayMinMs: 3_000,
    answerDelayMaxMs: 8_000,
    nextDelayMinMs: 1_000,
    nextDelayMaxMs: 1_000,
    autoClickNext: true,
    loopWaitAfterNextMs: 2_500,
    alertOnNotFound: true,
    autoLookupIndex: true,
    clickServerUrl: "http://127.0.0.1:8765/click",
    serverNextDelayMinMs: 2_000,
    serverNextDelayMaxMs: 5_000,
    intentionalWrongRate: 0.05,
  });
}

function buildServerClickOptions(settings, onProgress) {
  return {
    ...buildAutoOptions(settings, onProgress),
    insertApiUrl: settings.insertApiUrl,
    serverNextDelayMinMs: settings.serverNextDelayMinMs ?? 2_000,
    serverNextDelayMaxMs: settings.serverNextDelayMaxMs ?? 5_000,
    intentionalWrongRate: settings.intentionalWrongRate ?? 0.05,
    allowIntentionalWrong: true,
    alertOnNotFound: false,
    autoPickFirstOnNotFound: true,
  };
}

async function runOneQuestionViaServerClick(apiUrl, clickApiUrl, options = {}) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.runOneQuestionViaServerClick(
    apiUrl,
    clickApiUrl,
    options
  );
}

async function invokeAutoClick(x, y, clickApiUrl) {
  const res = await chrome.runtime.sendMessage({
    type: "FETCH_AUTO_CLICK",
    x,
    y,
    clickApiUrl,
  });
  if (!res?.ok) {
    throw new Error(res?.error || "Gọi server click thất bại");
  }
  return res.data;
}

function buildAutoOptions(settings, onProgress) {
  return {
    answerDelayMinMs: settings.answerDelayMinMs,
    answerDelayMaxMs: settings.answerDelayMaxMs,
    nextDelayMinMs: settings.nextDelayMinMs,
    nextDelayMaxMs: settings.nextDelayMaxMs,
    autoClickNext: settings.autoClickNext,
    alertOnNotFound: settings.alertOnNotFound,
    insertApiUrl: settings.insertApiUrl,
    autoPickFirstOnNotFound: settings.autoPickFirstOnNotFound,
    defaultAnswerPosition: settings.defaultAnswerPosition,
    onProgress,
  };
}

async function waitForNextQuestion(prevQuestion, maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (loopState.stopRequested || serverLoopState.stopRequested) return false;
    try {
      const q = window.NCN_AUTO_ANSWER.getQuestionText();
      if (q && q !== prevQuestion) return true;
    } catch {
      /* trang chưa sẵn sàng */
    }
    await sleep(500);
  }
  return !loopState.stopRequested && !serverLoopState.stopRequested;
}

function updateServerLoopButton() {
  const btn = serverLoopState.loopBtn;
  if (!btn) return;
  if (serverLoopState.running) {
    btn.textContent = "Dừng auto server";
    btn.classList.add("ncn-server-loop-stop");
  } else {
    btn.textContent = "Auto server";
    btn.classList.remove("ncn-server-loop-stop");
  }
}

function broadcastServerLoopProgress(text) {
  chrome.runtime
    .sendMessage({
      type: "SERVER_LOOP_PROGRESS",
      running: serverLoopState.running,
      count: serverLoopState.count,
      text,
    })
    .catch(() => {});
}

async function runServerClickLoop() {
  if (serverLoopState.running) {
    serverLoopState.stopRequested = true;
    const el = serverLoopState.statusEl;
    if (el) el.textContent = "Đang dừng sau câu hiện tại…";
    broadcastServerLoopProgress("Đang dừng sau câu hiện tại…");
    updateServerLoopButton();
    return { ok: true, running: true, stopping: true };
  }

  if (loopState.running) {
    throw new Error("Loop cũ đang chạy — dừng trước.");
  }
  if (scrollLoopState.running) {
    throw new Error("Scroll loop đang chạy — dừng trước.");
  }
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }

  stopAutoLookupPoller();

  serverLoopState.running = true;
  serverLoopState.stopRequested = false;
  serverLoopState.count = 0;
  updateServerLoopButton();

  const settings = await loadAutoSettings();
  const statusEl = serverLoopState.statusEl;

  const setProgress = (text) => {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.classList.remove("error");
    }
    broadcastPageStatus(text);
    broadcastServerLoopProgress(text);
    chrome.runtime
      .sendMessage({ type: "SERVER_LOOP_PROGRESS", text })
      .catch(() => {});
  };

  (async () => {
    try {
      while (!serverLoopState.stopRequested) {
        if (await checkStopFlag()) {
          serverLoopState.stopRequested = true;
          setProgress("Dừng bởi hotkey Ctrl+Shift+Q");
          break;
        }

        serverLoopState.count += 1;
        const n = serverLoopState.count;
        window.NCN_LOG?.log("flow", `Auto server câu ${n}`);
        setProgress(`[Câu ${n}] Đang xử lý…`);

        const res = await runOneQuestionViaServerClick(
          settings.answerApiUrl,
          settings.clickServerUrl,
          buildServerClickOptions(settings, (text) =>
            setProgress(`[Câu ${n}] ${text}`)
          )
        );

        if (serverLoopState.stopRequested) break;

        const tag = res.intentionalWrong
          ? `sai cố ý [${res.pickIndex}]`
          : res.usedFallback
            ? `chưa DB → đại [${res.pickIndex}]${res.insertedToDb ? " +insert" : ""}`
            : `index ${res.pickIndex}`;
        const retryNote =
          res.answerClickAttempts > 1 || res.nextClickAttempts > 1
            ? ` (click×${res.answerClickAttempts}/${res.nextClickAttempts})`
            : "";
        setProgress(`[Câu ${n}] Xong — ${tag} → Tiếp${retryNote}`);

        setProgress(`[Câu ${n}] Chờ câu tiếp…`);
        const prevQ = res.question;
        await sleep(settings.loopWaitAfterNextMs ?? 2_500);
        await waitForNextQuestion(prevQ, 20_000);

        if (serverLoopState.stopRequested) break;
      }
    } catch (err) {
      const msg = err?.message || "Lỗi auto server";
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.classList.add("error");
      }
      broadcastServerLoopProgress(msg);
    } finally {
      const done = serverLoopState.count;
      const wasStop = serverLoopState.stopRequested;
      serverLoopState.running = false;
      serverLoopState.stopRequested = false;
      updateServerLoopButton();

      const finalMsg = wasStop
        ? `Auto server dừng — ${done} câu.`
        : `Auto server kết thúc — ${done} câu.`;
      if (statusEl && !statusEl.classList.contains("error")) {
        statusEl.textContent = finalMsg;
      }
      broadcastServerLoopProgress(finalMsg);
      chrome.runtime
        .sendMessage({
          type: "SERVER_LOOP_STOPPED",
          count: done,
          text: finalMsg,
        })
        .catch(() => {});

      if (!wasStop) {
        try {
          setProgress("Hoàn thành — click Kết thúc luyện thi…");
          await sleep(
            settings.serverEndTestDelayMs ?? 1_500
          );
          await window.NCN_AUTO_ANSWER.serverClickKetThucLuyenThi(
            settings.clickServerUrl,
            { onProgress: (text) => setProgress(text) }
          );
          setProgress("Đã click Kết thúc luyện thi.");
        } catch (e) {
          window.NCN_LOG?.log(
            "flow",
            "Không click được Kết thúc luyện thi",
            e?.message
          );
        }
      }

      if (autoLookupState.enabled) {
        startAutoLookupPoller(statusEl || null);
      }
    }
  })();

  return { ok: true, running: true, started: true };
}

function updateScrollLoopButton() {
  const btn = scrollLoopState.loopBtn;
  if (!btn) return;
  if (scrollLoopState.running) {
    btn.textContent = "Dừng scroll";
    btn.classList.add("ncn-scroll-loop-stop");
  } else {
    btn.textContent = "Loop scroll";
    btn.classList.remove("ncn-scroll-loop-stop");
  }
}

function broadcastScrollLoopProgress(text) {
  chrome.runtime
    .sendMessage({
      type: "SCROLL_LOOP_PROGRESS",
      running: scrollLoopState.running,
      count: scrollLoopState.count,
      text,
    })
    .catch(() => {});
}

const SCROLL_LOOP_SELECTOR = "#learn-item-content";

function getScrollLoopTarget() {
  const el = document.querySelector(SCROLL_LOOP_SELECTOR);
  if (el) return el;

  return null;
}

function findScrollContainer(root) {
  if (!root) return null;

  const canScroll = (el) => {
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    return (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      el.scrollHeight > el.clientHeight + 10
    );
  };

  if (canScroll(root)) return root;

  for (const el of root.querySelectorAll("*")) {
    if (canScroll(el)) return el;
  }

  return root;
}

function randomScrollOnce() {
  const root = getScrollLoopTarget();
  const amount = randomMs(120, 480) * (Math.random() < 0.45 ? -1 : 1);

  if (!root) {
    window.scrollBy({ top: amount, behavior: "smooth" });
    return {
      amount,
      dir: amount > 0 ? "↓" : "↑",
      target: "fallback (không thấy #learn-item-content)",
    };
  }

  root.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });

  const target = findScrollContainer(root);
  const rect = target.getBoundingClientRect();
  const clientX = Math.floor(rect.left + Math.min(rect.width / 2, Math.max(rect.width - 1, 1)));
  const clientY = Math.floor(rect.top + Math.min(rect.height / 2, Math.max(rect.height - 1, 1)));
  const wheelTarget = document.elementFromPoint(clientX, clientY) || target;

  wheelTarget.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY: amount,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window,
    })
  );

  const canScrollTarget =
    target.scrollHeight > target.clientHeight + 10 &&
    target !== document.documentElement &&
    target !== document.body;

  if (canScrollTarget) {
    target.scrollBy({ top: amount, behavior: "smooth" });
  } else {
    window.scrollBy({ top: amount, behavior: "smooth" });
  }

  const dir = amount > 0 ? "↓" : "↑";
  return {
    amount,
    dir,
    target: canScrollTarget
      ? `${SCROLL_LOOP_SELECTOR} (scrollable con)`
      : `${SCROLL_LOOP_SELECTOR} (scroll trang)`,
  };
}

async function runScrollLoop() {
  if (scrollLoopState.running) {
    scrollLoopState.stopRequested = true;
    const el = scrollLoopState.statusEl;
    if (el) el.textContent = "Đang dừng scroll loop…";
    broadcastScrollLoopProgress("Đang dừng scroll loop…");
    updateScrollLoopButton();
    return { ok: true, running: true, stopping: true };
  }

  if (loopState.running) {
    throw new Error("Loop làm bài đang chạy — dừng trước khi bật scroll loop.");
  }

  scrollLoopState.running = true;
  scrollLoopState.stopRequested = false;
  scrollLoopState.count = 0;
  updateScrollLoopButton();

  const settings = await loadAutoSettings();
  const statusEl = scrollLoopState.statusEl;
  const waitMinMs = settings.answerDelayMinMs ?? 3_000;
  const waitMaxMs = settings.answerDelayMaxMs ?? 8_000;

  const setProgress = (text) => {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.classList.remove("error");
    }
    broadcastScrollLoopProgress(text);
  };

  (async () => {
    try {
      while (!scrollLoopState.stopRequested) {
        scrollLoopState.count += 1;
        const n = scrollLoopState.count;
        const scroll = randomScrollOnce();
        setProgress(
          `[${n}] Scroll ${scroll.dir} ${Math.abs(scroll.amount)}px (${scroll.target})`
        );

        const waitMs = randomMs(waitMinMs, waitMaxMs);
        await waitWithCountdown(
          waitMs,
          (text) => setProgress(`[${n}] ${text}`),
          "Chờ",
          () => scrollLoopState.stopRequested
        );

        if (scrollLoopState.stopRequested) break;
      }
    } catch (err) {
      const msg = err?.message || "Lỗi scroll loop";
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.classList.add("error");
      }
      broadcastScrollLoopProgress(msg);
    } finally {
      const done = scrollLoopState.count;
      const wasStop = scrollLoopState.stopRequested;
      scrollLoopState.running = false;
      scrollLoopState.stopRequested = false;
      updateScrollLoopButton();

      const finalMsg = wasStop
        ? `Scroll loop dừng — ${done} lần.`
        : `Scroll loop kết thúc — ${done} lần.`;
      if (statusEl && !statusEl.classList.contains("error")) {
        statusEl.textContent = finalMsg;
      }
      broadcastScrollLoopProgress(finalMsg);
      chrome.runtime
        .sendMessage({
          type: "SCROLL_LOOP_STOPPED",
          count: done,
          text: finalMsg,
        })
        .catch(() => {});
    }
  })();

  return { ok: true, running: true, started: true };
}

async function runAutoAnswerLoop() {
  if (loopState.running) {
    loopState.stopRequested = true;
    const el = loopState.statusEl;
    if (el) el.textContent = "Đang dừng sau câu hiện tại…";
    broadcastLoopProgress("Đang dừng sau câu hiện tại…");
    updateLoopButton();
    return { ok: true, running: true, stopping: true };
  }

  if (scrollLoopState.running) {
    throw new Error("Scroll loop đang chạy — dừng trước khi bật loop làm bài.");
  }

  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }

  loopState.running = true;
  loopState.stopRequested = false;
  loopState.count = 0;
  updateLoopButton();

  const settings = await loadAutoSettings();
  const statusEl = loopState.statusEl;

  const setProgress = (text) => {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.classList.remove("error");
    }
    broadcastLoopProgress(text);
    chrome.runtime
      .sendMessage({ type: "AUTO_ANSWER_PROGRESS", text })
      .catch(() => {});
  };

  (async () => {
    try {
      while (!loopState.stopRequested) {
        loopState.count += 1;
        const n = loopState.count;
        window.NCN_LOG?.log("flow", `Loop câu ${n} — bắt đầu`);
        setProgress(`[Câu ${n}] Đang xử lý…`);

        const res = await runAutoAnswer(settings.answerApiUrl, {
          ...buildAutoOptions(settings, (text) => setProgress(`[Câu ${n}] ${text}`)),
        });

        if (loopState.stopRequested) break;

        if (!settings.autoClickNext || !res.nextClick) {
          setProgress(
            `[Câu ${n}] Xong${res.nextClick ? "" : " — không bấm được Tiếp, dừng loop."}`
          );
          break;
        }

        setProgress(`[Câu ${n}] Xong — chờ câu tiếp…`);
        const prevQ = res.question;
        await sleep(settings.loopWaitAfterNextMs ?? 2_500);
        await waitForNextQuestion(prevQ, 20_000);

        if (loopState.stopRequested) break;
      }
    } catch (err) {
      const msg = err?.message || "Lỗi loop";
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.classList.add("error");
      }
      broadcastLoopProgress(msg);
    } finally {
      const done = loopState.count;
      const wasStop = loopState.stopRequested;
      loopState.running = false;
      loopState.stopRequested = false;
      updateLoopButton();

      const finalMsg = wasStop
        ? `Loop đã dừng — hoàn thành ${done} câu.`
        : `Loop kết thúc — ${done} câu.`;
      if (statusEl && !statusEl.classList.contains("error")) {
        statusEl.textContent = finalMsg;
      }
      broadcastLoopProgress(finalMsg);
      chrome.runtime
        .sendMessage({
          type: "LOOP_STOPPED",
          count: done,
          text: finalMsg,
        })
        .catch(() => {});
    }
  })();

  return { ok: true, running: true, started: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (PAGE_READ_ONLY && DOM_INTERACTION_BLOCKED.has(message?.type)) {
    sendResponse({ ok: false, error: DOM_INTERACTION_ERROR });
    return false;
  }

  if (message?.type === "PAGE_READ_ONLY_STATUS") {
    sendResponse({
      ok: true,
      readOnly: PAGE_READ_ONLY,
      autoLookup: autoLookupState.enabled,
      serverLoop: serverLoopState.running,
    });
    return false;
  }

  if (message?.type === "AUTO_LOOKUP_TOGGLE") {
    (async () => {
      autoLookupState.enabled = message.enabled ?? !autoLookupState.enabled;
      await chrome.storage.sync.set({ autoLookupIndex: autoLookupState.enabled });
      if (autoLookupState.enabled) {
        autoLookupState.lastKey = null;
        startAutoLookupPoller(null);
      } else {
        stopAutoLookupPoller();
      }
      sendResponse({ ok: true, enabled: autoLookupState.enabled });
    })();
    return true;
  }

  if (message?.type === "LOOKUP_ANSWER") {
    runAutoLookupIfChanged(true)
      .then(() => sendResponse({ ok: true }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || String(err) })
      );
    return true;
  }

  if (message?.type === "SERVER_CLICK_ONE") {
    (async () => {
      try {
        const settings = await loadAutoSettings();
        const res = await runOneQuestionViaServerClick(
          settings.answerApiUrl,
          settings.clickServerUrl,
          {
            ...buildServerClickOptions(settings, broadcastPageStatus),
            intentionalWrongRate: 0,
            allowIntentionalWrong: false,
          }
        );
        const lines = [
          `Xong — index ${res.pickIndex}`,
          `đáp án: ${res.answerCoords.screenX}, ${res.answerCoords.screenY}`,
          res.answerClick?.url || "",
          `Tiếp: ${res.nextCoords.screenX}, ${res.nextCoords.screenY}`,
          res.nextClick?.url || "",
        ].filter(Boolean);
        broadcastPageStatus(lines.join("\n"));
        sendResponse({ ok: true, ...res, message: lines.join("\n") });
      } catch (err) {
        broadcastPageStatus(err?.message || "Lỗi", { error: true });
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "PUSH_RESULT") {
    (async () => {
      try {
        const settings = await loadAutoSettings();
        const res = await runPushPageResult(settings.insertApiUrl, {
          onProgress: broadcastPageStatus,
        });
        broadcastPageStatus(res.message);
        sendResponse({ ok: true, ...res });
      } catch (err) {
        broadcastPageStatus(err?.message || "Lỗi", { error: true });
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "XPATH_CLICK") {
    (async () => {
      try {
        if (!window.NCN_XPATH) {
          throw new Error("Module click chưa sẵn sàng — tải lại trang.");
        }
        const result = window.NCN_XPATH.clickByXPath(message.xpath);
        await chrome.storage.sync.set({ [XPATH_STORAGE_KEY]: message.xpath });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err), xpath: message.xpath });
      }
    })();
    return true;
  }

  if (message?.type === "GET_XPATH_PRESET") {
    try {
      if (!window.NCN_AUTO_ANSWER) throw new Error("Module chưa sẵn sàng");
      const panel = window.NCN_AUTO_ANSWER.findActiveQuestionPanel();
      const xpath =
        message.preset === "answer1"
          ? window.NCN_AUTO_ANSWER.buildAnswerXPath(panel, 0)
          : window.NCN_AUTO_ANSWER.buildQuestionXPath(panel);
      sendResponse({ ok: true, xpath });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
    return true;
  }

  if (message?.type === "SCROLL_LOOP_TOGGLE") {
    runScrollLoop()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === "SCROLL_LOOP_STATUS") {
    sendResponse({
      ok: true,
      running: scrollLoopState.running,
      count: scrollLoopState.count,
      stopRequested: scrollLoopState.stopRequested,
    });
    return true;
  }

  if (message?.type === "SERVER_LOOP_TOGGLE") {
    runServerClickLoop()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === "SERVER_LOOP_STATUS") {
    sendResponse({
      ok: true,
      running: serverLoopState.running,
      count: serverLoopState.count,
      stopRequested: serverLoopState.stopRequested,
    });
    return false;
  }

  if (message?.type === "LOOP_TOGGLE") {
    runAutoAnswerLoop()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === "LOOP_STATUS") {
    sendResponse({
      ok: true,
      running: loopState.running,
      count: loopState.count,
      stopRequested: loopState.stopRequested,
    });
    return true;
  }

  if (message?.type === "CLICK_NEXT_TEST") {
    (async () => {
      try {
        const settings = await loadAutoSettings();
        const result = await runTestClickNext(
          {
            nextDelayMinMs: settings.nextDelayMinMs,
            nextDelayMaxMs: settings.nextDelayMaxMs,
          },
          (text) => {
            chrome.runtime.sendMessage({ type: "CLICK_NEXT_PROGRESS", text }).catch(() => {});
          }
        );
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "INSERT_ANSWER") {
    (async () => {
      try {
        const settings = await loadAutoSettings();
        const result = await runInsertAnswer(settings.insertApiUrl, (text) => {
          chrome.runtime.sendMessage({ type: "INSERT_ANSWER_PROGRESS", text }).catch(() => {});
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "QUESTION_STATUS") {
    (async () => {
      try {
        await window.NCN_LOG?.loadFromStorage?.();
        const settings = await loadAutoSettings();
        const result = await runQuestionStatus(settings.answerApiUrl, (text) => {
          chrome.runtime
            .sendMessage({ type: "QUESTION_STATUS_PROGRESS", text })
            .catch(() => {});
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "CHECK_ANSWER") {
    (async () => {
      try {
        const settings = await loadAutoSettings();
        const result = await runCheckAnswer(settings.answerApiUrl, (text) => {
          chrome.runtime.sendMessage({ type: "CHECK_ANSWER_PROGRESS", text }).catch(() => {});
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "AUTO_ANSWER" || message?.type === "AUTO_ANSWER_PICK_ONLY") {
    (async () => {
      try {
        const settings = await loadAutoSettings();
        const pickOnly = message.type === "AUTO_ANSWER_PICK_ONLY";
        const result = await runAutoAnswer(
          message.apiUrl || settings.answerApiUrl,
          {
            ...buildAutoOptions(settings, (text) => {
              chrome.runtime.sendMessage({ type: "AUTO_ANSWER_PROGRESS", text }).catch(() => {});
            }),
            pickOnly,
          }
        );
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "SIMULATION_LOOKUP") {
    (async () => {
      try {
        const sim = window.NCN_SIMULATION;
        if (!sim) throw new Error("Module mô phỏng chưa sẵn sàng");
        const { situationTitle, situationQuestion } = sim.readSituation();
        if (!situationQuestion) throw new Error("Không đọc được câu hỏi mô phỏng");

        const res = await chrome.runtime.sendMessage({
          type: "FETCH_SIMULATION_ANSWER",
          situationTitle,
          situationQuestion,
        });
        if (!res?.ok) throw new Error(res?.error || "Lỗi gọi API mô phỏng");

        if (res.data?.found) {
          sendResponse({
            ok: true,
            found: true,
            stopSecond: res.data.data?.stopSecond,
            stopPercent: res.data.data?.stopPercent,
            videoDuration: res.data.data?.videoDuration,
            matchedBy: res.data.data?.matchedBy,
            message: `Đã có KQ: dừng ở ${res.data.data?.stopSecond}s`,
          });
        } else {
          sendResponse({ ok: true, found: false, message: "Chưa có KQ mô phỏng" });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "SIMULATION_CALCULATE") {
    (async () => {
      try {
        const sim = window.NCN_SIMULATION;
        if (!sim) throw new Error("Module mô phỏng chưa sẵn sàng");

        const calcResult = sim.calculateStopTimeFromMarks();
        if (calcResult.error) {
          sendResponse({ ok: false, error: calcResult.error });
          return;
        }

        const { situationTitle, situationQuestion } = sim.readSituation();

        const res = await chrome.runtime.sendMessage({
          type: "FETCH_SIMULATION_INSERT",
          situationTitle,
          situationQuestion,
          stopSecond: calcResult.stopSecond,
          stopPercent: calcResult.stopPercent,
          videoDuration: calcResult.videoDuration,
          markColor: calcResult.markColor,
        });
        if (!res?.ok) throw new Error(res?.error || "Lỗi lưu KQ mô phỏng");

        sendResponse({
          ok: true,
          message: `Đã lưu: dừng ở ${calcResult.stopSecond}s (${calcResult.stopPercent}%)`,
          stopSecond: calcResult.stopSecond,
          stopPercent: calcResult.stopPercent,
        });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "SIMULATION_READ") {
    try {
      const sim = window.NCN_SIMULATION;
      if (!sim) throw new Error("Module mô phỏng chưa sẵn sàng");
      const situation = sim.readSituation();
      const playCoords = sim.getPlayButtonCoords();
      const stopCoords = sim.getStopButtonCoords();
      const duration = sim.getVideoDuration();
      const playedPct = sim.getPlayedPercent();
      sendResponse({
        ok: true,
        situation,
        playCoords,
        stopCoords,
        videoDuration: duration,
        playedPercent: playedPct,
      });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
    return true;
  }

  if (message?.type === "SIMULATION_AUTO") {
    (async () => {
      const PROGRESS_TYPE = "SIMULATION_AUTO_PROGRESS";
      const LOOP_TYPE = "SIMULATION_LOOP_PROGRESS";
      function progress(text) {
        chrome.runtime.sendMessage({ type: PROGRESS_TYPE, text }).catch(() => {});
      }

      const sim = window.NCN_SIMULATION;
      if (!sim) {
        sendResponse({ ok: false, error: "Module mô phỏng chưa sẵn sàng" });
        return;
      }

      async function waitForVideoPlaying() {
        let waited = 0;
        while (!sim.isVideoPlaying() && waited < 30) {
          await sleep(500);
          waited += 0.5;
        }
      }

      async function clickServer(coords, label) {
        if (!coords) { progress(`Không tìm thấy nút ${label}`); return false; }
        const rx = Math.round(coords.x + (Math.random() - 0.5) * 12);
        const ry = Math.round(coords.y + (Math.random() - 0.5) * 12);
        const res = await chrome.runtime.sendMessage({
          type: "FETCH_AUTO_CLICK", x: rx, y: ry,
        });
        return res?.ok === true;
      }

      async function runOneCycle(settings, cycleLabel) {
        const { situationTitle, situationQuestion } = sim.readSituation();
        if (!situationQuestion) return { error: "Không đọc được câu hỏi mô phỏng" };

        progress(cycleLabel ? `${cycleLabel}: Đang tra KQ…` : "Đang tra KQ…");

        const lookupRes = await chrome.runtime.sendMessage({
          type: "FETCH_SIMULATION_ANSWER", situationTitle, situationQuestion,
        });
        if (!lookupRes?.ok) throw new Error(lookupRes?.error || "Lỗi tra KQ");

        let stopSecond = null;
        let mode = "unknown";

        if (lookupRes.data?.found) {
          stopSecond = lookupRes.data.data?.stopSecond;
          mode = "known";
          progress(`${cycleLabel}Có KQ: ${stopSecond}s. Chờ video…`);
        } else {
          progress(`${cycleLabel}Chưa có KQ. Chờ video…`);
        }

        await waitForVideoPlaying();

        if (mode === "known") {
          const currentTime = sim.getVideoCurrentTime();
          const randomOff = Math.random() * 1.5;
          let delaySec = stopSecond - currentTime - 0.5 + randomOff;
          if (delaySec < 0.5) delaySec = 0.5;
          progress(`${cycleLabel}Chờ ${delaySec.toFixed(1)}s (offset +${randomOff.toFixed(1)}s)…`);
          await sleep(delaySec * 1000);
        } else {
          const effectiveDur = Math.max(5, (sim.getVideoDuration() || 25) - 10);
          const minDelay = effectiveDur * 0.3;
          const maxDelay = effectiveDur * 0.7;
          const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
          progress(`${cycleLabel}Random ${randomDelay.toFixed(1)}s (${effectiveDur.toFixed(0)}s vid)…`);
          await sleep(randomDelay * 1000);
        }

        progress(`${cycleLabel}Click dừng…`);
        await clickServer(sim.getStopButtonCoords(), "dừng");
        await sleep(1000);

        if (mode === "unknown") {
          const calcResult = sim.calculateStopTimeFromMarks();
          if (!calcResult.error && calcResult.stopSecond) {
            stopSecond = calcResult.stopSecond;
            progress(`${cycleLabel}Đã tính: ${stopSecond}s. Lưu…`);
            await chrome.runtime.sendMessage({
              type: "FETCH_SIMULATION_INSERT",
              situationTitle, situationQuestion,
              stopSecond: calcResult.stopSecond,
              stopPercent: calcResult.stopPercent,
              videoDuration: calcResult.videoDuration,
              markColor: calcResult.markColor,
            }).catch(() => {});
          } else {
            progress(`${cycleLabel}Không đọc được marks`);
          }
        }

        await sleep(1500);

        const score = sim.getScoreInfo();
        const scoreText = score ? `${score.score}/${score.max}` : "?";
        progress(`${cycleLabel}Điểm: ${scoreText}. Dừng ở ${stopSecond || "?"}s`);

        const passed = score && score.score >= 3;

        if (passed) {
          const nextDelay = randomMs(settings.serverNextDelayMinMs ?? 2000, settings.serverNextDelayMaxMs ?? 5000);
          progress(`${cycleLabel}Đạt! Chờ ${(nextDelay/1000).toFixed(1)}s → Tiếp…`);
          await sleep(nextDelay);
          const ok = await clickServer(sim.getNextButtonCoords(), "Tiếp");
          if (!ok) {
            progress(`${cycleLabel}Không thấy Tiếp → Kết thúc luyện thi…`);
            await clickServer(sim.getFinishButtonCoords(), "Kết thúc");
          }
        } else {
          progress(`${cycleLabel}${score ? `Chưa đạt (${scoreText})` : "Không đọc được điểm"}. Làm lại…`);
          await sleep(2000);
          await clickServer(sim.getReplayButtonCoords(), "Làm lại");
          await sleep(1000);
          progress(`${cycleLabel}Click play…`);
          await clickServer(sim.getPlayButtonCoords(), "Play");
        }

        return { ok: true, stopSecond, mode, passed, score: scoreText };
      }

      try {
        const settings = await loadAutoSettings();
        const result = await runOneCycle(settings, "");
        sendResponse(result);
      } catch (err) {
        chrome.runtime.sendMessage({
          type: PROGRESS_TYPE, text: `Lỗi: ${err?.message || String(err)}`, error: true,
        }).catch(() => {});
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "SIMULATION_LOOP_TOGGLE") {
    if (simulationLoopState.running) {
      simulationLoopState.stopRequested = true;
      chrome.runtime.sendMessage({
        type: "SIMULATION_LOOP_PROGRESS",
        text: "Đang dừng auto mô phỏng…",
        running: true,
        count: simulationLoopState.count,
      }).catch(() => {});
      sendResponse({ ok: true, stopping: true });
      return true;
    }

    simulationLoopState.running = true;
    simulationLoopState.stopRequested = false;
    simulationLoopState.count = 0;
    sendResponse({ ok: true, started: true });

    (async () => {
      const LOOP_TYPE = "SIMULATION_LOOP_PROGRESS";
      function loopProgress(text) {
        chrome.runtime.sendMessage({
          type: LOOP_TYPE, text, running: simulationLoopState.running,
          count: simulationLoopState.count,
        }).catch(() => {});
      }

      async function sleepCheckStop(ms) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (simulationLoopState.stopRequested) return;
          if (await checkStopFlag()) {
            simulationLoopState.stopRequested = true;
            return;
          }
          const remaining = Math.min(500, Math.max(0, end - Date.now()));
          await sleep(remaining);
        }
      }

      const sim = window.NCN_SIMULATION;
      if (!sim) {
        loopProgress("Module mô phỏng chưa sẵn sàng");
        simulationLoopState.running = false;
        return;
      }

      async function waitForVideoPlaying() {
        let waited = 0;
        while (!sim.isVideoPlaying() && waited < 30) {
          if (simulationLoopState.stopRequested) return false;
          await sleepCheckStop(500);
          waited += 0.5;
        }
        return sim.isVideoPlaying();
      }

      async function clickServer(coords, label) {
        if (!coords) return false;
        const rx = Math.round(coords.x + (Math.random() - 0.5) * 12);
        const ry = Math.round(coords.y + (Math.random() - 0.5) * 12);
        const res = await chrome.runtime.sendMessage({
          type: "FETCH_AUTO_CLICK", x: rx, y: ry,
        });
        return res?.ok === true;
      }

      try {
        const settings = await loadAutoSettings();

        while (simulationLoopState.running && !simulationLoopState.stopRequested) {
          if (await checkStopFlag()) {
            simulationLoopState.stopRequested = true;
            loopProgress("Dừng bởi hotkey Ctrl+Shift+Q");
            break;
          }

          simulationLoopState.count++;
          const c = simulationLoopState.count;
          const label = `[${c}] `;

          const { situationTitle, situationQuestion } = sim.readSituation();
          if (!situationQuestion) {
            loopProgress(`${label}Không đọc được câu hỏi`);
            await sleepCheckStop(3000);
            continue;
          }

          loopProgress(`${label}Đang tra KQ…`);

          const lookupRes = await chrome.runtime.sendMessage({
            type: "FETCH_SIMULATION_ANSWER", situationTitle, situationQuestion,
          }).catch(() => null);

          let stopSecond = null;
          let mode = "unknown";

          if (lookupRes?.ok && lookupRes.data?.found) {
            stopSecond = lookupRes.data.data?.stopSecond;
            mode = "known";
            loopProgress(`${label}Có KQ: ${stopSecond}s`);
          } else {
            loopProgress(`${label}Chưa có KQ`);
          }

          const playing = await waitForVideoPlaying();
          if (!playing || simulationLoopState.stopRequested) break;

          if (mode === "known") {
            const currentTime = sim.getVideoCurrentTime();
            const randomOff = Math.random() * 1.5;
            let delaySec = stopSecond - currentTime - 0.5 + randomOff;
            if (delaySec < 0.5) delaySec = 0.5;
            loopProgress(`${label}Chờ ${delaySec.toFixed(1)}s…`);
            await sleepCheckStop(delaySec * 1000);
            if (simulationLoopState.stopRequested) break;
          } else {
            const effectiveDur = Math.max(5, (sim.getVideoDuration() || 25) - 10);
            const minDelay = effectiveDur * 0.3;
            const maxDelay = effectiveDur * 0.7;
            const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
            loopProgress(`${label}Random ${randomDelay.toFixed(1)}s (${effectiveDur.toFixed(0)}s vid)…`);
            await sleepCheckStop(randomDelay * 1000);
            if (simulationLoopState.stopRequested) break;
          }

          loopProgress(`${label}Click dừng…`);
          await clickServer(sim.getStopButtonCoords(), "dừng");
          await sleepCheckStop(1000);

          if (mode === "unknown") {
            const calcResult = sim.calculateStopTimeFromMarks();
            if (!calcResult.error && calcResult.stopSecond) {
              stopSecond = calcResult.stopSecond;
              loopProgress(`${label}Tính: ${stopSecond}s. Lưu…`);
              await chrome.runtime.sendMessage({
                type: "FETCH_SIMULATION_INSERT",
                situationTitle, situationQuestion,
                stopSecond: calcResult.stopSecond,
                stopPercent: calcResult.stopPercent,
                videoDuration: calcResult.videoDuration,
                markColor: calcResult.markColor,
              }).catch(() => {});
            }
          }

          await sleepCheckStop(1500);
          if (simulationLoopState.stopRequested) break;

          const score = sim.getScoreInfo();
          const scoreText = score ? `${score.score}/${score.max}` : "?";
          const passed = score && score.score >= 3;

          if (passed) {
            const nextDelay = randomMs(settings.serverNextDelayMinMs ?? 2000, settings.serverNextDelayMaxMs ?? 5000);
            loopProgress(`${label}Điểm ${scoreText} - ĐẠT! → Tiếp…`);
            await sleepCheckStop(nextDelay);
            if (simulationLoopState.stopRequested) break;
            const ok = await clickServer(sim.getNextButtonCoords(), "Tiếp");
            if (!ok) {
              loopProgress(`${label}Không thấy Tiếp → Kết thúc luyện thi…`);
              await clickServer(sim.getFinishButtonCoords(), "Kết thúc");
            }
            await sleepCheckStop(5000);
          } else {
            loopProgress(`${label}Điểm ${scoreText} - Chưa đạt → Làm lại…`);
            await sleepCheckStop(2000);
            if (simulationLoopState.stopRequested) break;
          await clickServer(sim.getReplayButtonCoords(), "Làm lại");
          await sleepCheckStop(1000);
          if (simulationLoopState.stopRequested) break;
            loopProgress(`${label}Click play…`);
            await clickServer(sim.getPlayButtonCoords(), "Play");
          }

          if (simulationLoopState.stopRequested) break;
        }
      } catch (err) {
        chrome.runtime.sendMessage({
          type: LOOP_TYPE, text: `Lỗi loop: ${err?.message || String(err)}`, error: true, running: false,
        }).catch(() => {});
      }

      simulationLoopState.running = false;
      simulationLoopState.stopRequested = false;
      chrome.runtime.sendMessage({
        type: "SIMULATION_LOOP_STOPPED",
        text: `Đã dừng auto mô phỏng (${simulationLoopState.count} lần)`,
      }).catch(() => {});
    })();
    return true;
  }

  if (message?.type === "SIMULATION_LOOP_STATUS") {
    sendResponse({
      ok: true,
      running: simulationLoopState.running,
      count: simulationLoopState.count,
      stopRequested: simulationLoopState.stopRequested,
    });
    return false;
  }

  if (message?.type === "STOP_ALL") {
    serverLoopState.stopRequested = true;
    simulationLoopState.stopRequested = true;
    loopState.stopRequested = true;
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function runAutoAnswer(apiUrl, options = {}) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.runAutoAnswer(apiUrl, options);
}

async function runQuestionStatus(apiUrl, onProgress) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.getQuestionStatus(apiUrl, { onProgress });
}

async function runCheckAnswer(apiUrl, onProgress) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  const settings = await loadAutoSettings();
  return window.NCN_AUTO_ANSWER.checkCurrentAnswer(apiUrl, {
    onProgress,
    insertApiUrl: settings.insertApiUrl,
  });
}

async function runInsertAnswer(insertApiUrl, onProgress) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.insertCurrentAnswer(insertApiUrl, { onProgress });
}

async function runTestClickNext(options, onProgress) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.testClickNext({ ...options, onProgress });
}

async function runLookupAnswer(apiUrl, options = {}) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.lookupAnswerIndex(apiUrl, options);
}

async function runPushPageResult(insertApiUrl, options = {}) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.pushPageResultToServer(insertApiUrl, options);
}

async function runGetAnswerCoords(apiUrl, options = {}) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.getCorrectAnswerCoordinates(apiUrl, options);
}

async function runGetNextButtonCoords(options = {}) {
  if (!window.NCN_AUTO_ANSWER) {
    throw new Error("Module trả lời chưa sẵn sàng — tải lại trang.");
  }
  return window.NCN_AUTO_ANSWER.getNextButtonClickCoordinates(options);
}

function getActiveQuestionKey() {
  if (!window.NCN_AUTO_ANSWER) return null;
  try {
    const panel = window.NCN_AUTO_ANSWER.findActiveQuestionPanel();
    const raw = window.NCN_AUTO_ANSWER.getQuestionText(panel);
    return window.NCN_AUTO_ANSWER.buildQuestionForApi(raw, panel);
  } catch {
    return null;
  }
}

function tickAutoLookup() {
  if (!autoLookupState.enabled || autoLookupState.busy) return;

  const key = getActiveQuestionKey();
  if (!key || key === autoLookupState.lastKey) return;

  void runAutoLookupIfChanged();
}

function stopAutoLookupPoller() {
  if (autoLookupState.pollTimer) {
    clearInterval(autoLookupState.pollTimer);
    autoLookupState.pollTimer = null;
  }
}

async function runAutoLookupIfChanged(force = false) {
  if (!autoLookupState.enabled && !force) return;
  if (autoLookupState.busy) return;

  const key = getActiveQuestionKey();
  if (!key) {
    if (force) {
      const msg = "Không đọc được câu hỏi trên trang";
      if (autoLookupState.statusEl) {
        autoLookupState.statusEl.textContent = msg;
        autoLookupState.statusEl.classList.add("error");
        autoLookupState.statusEl.classList.remove("ncn-status-index");
      } else {
        broadcastPageStatus(msg, { lookup: true, error: true });
      }
    }
    return;
  }
  if (!force && key === autoLookupState.lastKey) return;

  autoLookupState.busy = true;
  const statusEl = autoLookupState.statusEl;

  try {
    const progress = (text) => {
      if (statusEl) {
        statusEl.classList.remove("error", "ncn-status-log", "ncn-has-xpath");
        statusEl.textContent = text;
      } else {
        broadcastPageStatus(text, { lookup: true });
      }
    };
    progress("Đang tra index…");

    const settings = await loadAutoSettings();
    const res = await runLookupAnswer(settings.answerApiUrl, {
      alertOnNotFound: false,
      onProgress: progress,
    });

    autoLookupState.lastKey = key;
    if (statusEl) {
      statusEl.textContent = res.message;
      statusEl.classList.add("ncn-status-index");
      statusEl.classList.remove("error");
    } else {
      broadcastPageStatus(res.message, { lookup: true });
    }
  } catch (err) {
    autoLookupState.lastKey = key;
    const msg =
      err?.code === "QUESTION_NOT_FOUND"
        ? "Chưa có DB"
        : err?.message || "Lỗi tra index";
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.classList.toggle("error", err?.code === "QUESTION_NOT_FOUND");
      statusEl.classList.remove("ncn-status-index");
    } else {
      broadcastPageStatus(msg, { lookup: true, error: true });
    }
  } finally {
    autoLookupState.busy = false;
  }
}

function startAutoLookupPoller(statusEl) {
  autoLookupState.statusEl = statusEl;
  stopAutoLookupPoller();
  if (!autoLookupState.enabled) return;

  autoLookupState.pollTimer = setInterval(tickAutoLookup, AUTO_LOOKUP_INTERVAL_MS);
  tickAutoLookup();
}

async function initAutoLookupFromSettings() {
  const { autoLookupIndex } = await loadAutoSettings();
  autoLookupState.enabled = autoLookupIndex !== false;
}

async function init() {
  await initAutoLookupFromSettings();
  if (autoLookupState.enabled) {
    startAutoLookupPoller(null);
  }
}

init();
