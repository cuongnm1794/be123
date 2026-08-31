const HOST = "namcaonguyen.huelms.com";

function buildFilename(settings, kind, pageTitle) {
  const subfolder = (settings.subfolder || "namcaonguyen-sources").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const stamp = settings.includeTimestamp !== false ? formatStamp(new Date()) : "";
  const safeTitle = sanitizeFilename(pageTitle || "page");
  const ext = kind === "scripts" ? "json" : "html";
  const base = stamp ? `${safeTitle}_${stamp}` : safeTitle;
  const suffix = kind === "scripts" ? "_scripts" : "";
  return `${subfolder}/${base}${suffix}.${ext}`;
}

function formatStamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "page";
}

const DEFAULT_ANSWER_API = "http://localhost:3003/api/answer";
const DEFAULT_INSERT_API = "http://localhost:3003/api/insert";
const DEFAULT_CLICK_API = "http://127.0.0.1:8765/click";
const AUTO_PY_BASE = "http://127.0.0.1:8765";
const DEFAULT_SIMULATION_ANSWER_API = "http://localhost:3003/api/simulation/answer";
const DEFAULT_SIMULATION_INSERT_API = "http://localhost:3003/api/simulation/insert";
const DEFAULT_SIM_QUIZ_ANSWER_API = "http://localhost:3003/api/simulation-quiz/answer";
const DEFAULT_SIM_QUIZ_INSERT_API = "http://localhost:3003/api/simulation-quiz/insert";
const DEFAULT_SIM_QUIZ_DEBUG_API = "http://localhost:3003/api/simulation-quiz/debug";
const DEFAULT_SIM_QUIZ_INSERT_BATCH_API =
  "http://localhost:3003/api/simulation-quiz/insert-batch";

async function getSettings() {
  return chrome.storage.sync.get({
    subfolder: "namcaonguyen-sources",
    includeTimestamp: true,
    saveAsDialog: false,
    showFloatingBar: false,
    bypassDevtoolsDetect: true,
    answerApiUrl: DEFAULT_ANSWER_API,
    insertApiUrl: DEFAULT_INSERT_API,
    simQuizAnswerApiUrl: DEFAULT_SIM_QUIZ_ANSWER_API,
    simQuizInsertApiUrl: DEFAULT_SIM_QUIZ_INSERT_API,
    simQuizDebugApiUrl: DEFAULT_SIM_QUIZ_DEBUG_API,
    simQuizInsertBatchApiUrl: DEFAULT_SIM_QUIZ_INSERT_BATCH_API,
    clickServerUrl: DEFAULT_CLICK_API,
    ncnUserId: 1,
  });
}

async function forwardNotifyToAutoPy(payload = {}) {
  const settings = await getSettings();
  const userId = Number(payload.userId ?? settings.ncnUserId) || 1;
  const u = new URL(`${AUTO_PY_BASE}/notify`);
  u.searchParams.set("user_id", String(userId));
  u.searchParams.set("event", String(payload.event || "info"));
  if (payload.userName) u.searchParams.set("user_name", String(payload.userName));
  if (payload.practiceRound != null) {
    u.searchParams.set("practice_round", String(payload.practiceRound));
  }
  if (payload.maxRounds != null) {
    u.searchParams.set("max_rounds", String(payload.maxRounds));
  }
  if (payload.message) u.searchParams.set("message", String(payload.message));
  if (payload.pageUrl) u.searchParams.set("page_url", String(payload.pageUrl));

  const res = await fetch(u.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data?.skipped) {
    throw new Error(data?.error || `Notify server ${res.status}`);
  }
  return data;
}

function buildClickServerUrl(clickApiUrl, x, y, userId = null) {
  const raw = (clickApiUrl || DEFAULT_CLICK_API).trim();
  const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
  u.searchParams.set("x", String(Math.round(x)));
  u.searchParams.set("y", String(Math.round(y)));
  if (userId != null) u.searchParams.set("user_id", String(userId));
  return u.toString();
}

function buildTypeServerUrl(baseUrl, text, x, y, clearFirst, userId) {
  const u = new URL(`${AUTO_PY_BASE}/type`);
  u.searchParams.set("text", String(text));
  if (x != null) u.searchParams.set("x", String(Math.round(x)));
  if (y != null) u.searchParams.set("y", String(Math.round(y)));
  if (clearFirst) u.searchParams.set("clear_first", "true");
  if (userId != null) u.searchParams.set("user_id", String(userId));
  return u.toString();
}

async function focusAtPoint(x, y) {
  const u = new URL(`${AUTO_PY_BASE}/focus-at`);
  u.searchParams.set("x", String(Math.round(x)));
  u.searchParams.set("y", String(Math.round(y)));
  await fetch(u.toString(), { method: "GET" }).catch(() => {});
}

async function focusOsUserWindow(userId) {
  if (userId == null) return;
  await fetch(`${AUTO_PY_BASE}/focus-window?user_id=${userId}`, {
    method: "GET",
  }).catch(() => {});
}

async function fetchAutoClick(x, y, clickApiUrl, userId = null) {
  await focusAtPoint(x, y);
  const url = buildClickServerUrl(clickApiUrl, x, y, userId);
  const res = await fetch(url, { method: "GET" });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Click server ${res.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
  }
  return { url, body: text };
}

async function fetchAutoScroll(x, y, amount, userId = null) {
  await focusAtPoint(x, y);
  const u = new URL(`${AUTO_PY_BASE}/scroll`);
  u.searchParams.set("x", String(Math.round(x)));
  u.searchParams.set("y", String(Math.round(y)));
  u.searchParams.set("amount", String(Math.round(amount)));
  if (userId != null) u.searchParams.set("user_id", String(userId));
  const res = await fetch(u.toString(), { method: "GET" });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Scroll server ${res.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
  }
  return { url: u.toString(), body: text };
}

async function fetchAutoType(text, x, y, clearFirst, userId) {
  if (x != null && y != null) {
    await focusAtPoint(x, y);
  }
  const url = buildTypeServerUrl(null, text, x, y, clearFirst, userId);
  const res = await fetch(url, { method: "GET" });
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Type server ${res.status}${body ? `: ${body.slice(0, 80)}` : ""}`);
  }
  return { url, body };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  }

  return res.json();
}

async function fetchAnswerFromApi(questionTitle, question, apiUrl) {
  const url = (apiUrl || DEFAULT_ANSWER_API).trim();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionTitle, question }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const notFound = res.status === 404 && data?.found === false;
    if (notFound) {
      return {
        success: true,
        found: false,
        error: data.error || "Chưa có đáp án cho câu hỏi này",
      };
    }
    const errorDetail = data?.error ? `: ${String(data.error).slice(0, 120)}` : "";
    throw new Error(`API ${res.status}${errorDetail}`);
  }

  if (data?.found === false && data?.success === false) {
    return { ...data, success: true };
  }

  return data;
}

async function insertAnswerToApi(payload, insertApiUrl) {
  const url = (insertApiUrl || DEFAULT_INSERT_API).trim();
  return postJson(url, {
    questionTitle: payload.questionTitle || "",
    question: payload.question,
    answerPosition: payload.answerPosition,
  });
}

async function fetchSimQuizAnswerFromApi(stimulusTitle, question, apiUrl) {
  const url = (apiUrl || DEFAULT_SIM_QUIZ_ANSWER_API).trim();
  console.log("[NCN] POST sim-quiz/answer", url, {
    stimulusTitle,
    question: String(question || "").slice(0, 120),
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stimulusTitle, question }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errorDetail = data?.error ? `: ${String(data.error).slice(0, 120)}` : "";
    throw new Error(`API ${res.status}${errorDetail}`);
  }

  return data;
}

async function insertSimQuizToApi(payload, insertApiUrl) {
  const url = (insertApiUrl || DEFAULT_SIM_QUIZ_INSERT_API).trim();
  const body = {
    stimulusTitle: payload.stimulusTitle,
    question: payload.question,
    correctAnswerIndex: payload.correctAnswerIndex,
  };
  console.log("[NCN] POST sim-quiz/insert", url, body);
  return postJson(url, body);
}

async function postSimQuizDebugToApi(payload, debugApiUrl) {
  const url = (debugApiUrl || DEFAULT_SIM_QUIZ_DEBUG_API).trim();
  console.log("[NCN] POST sim-quiz/debug", url, {
    stimulusTitle: payload?.stimulusTitle,
    panelCount: payload?.panels?.length,
    defaultMatchCount: payload?.defaultMatchCount,
  });
  return postJson(url, payload);
}

async function insertSimQuizBatchToApi(items, batchApiUrl) {
  const url = (batchApiUrl || DEFAULT_SIM_QUIZ_INSERT_BATCH_API).trim();
  console.log("[NCN] POST sim-quiz/insert-batch", url, { count: items?.length });
  return postJson(url, { items });
}

function isTargetUrl(url) {
  try {
    return new URL(url).hostname === HOST;
  } catch {
    return false;
  }
}

/** Inject lại guard mỗi lần refresh / chuyển URL (kể cả SPA). */
async function injectGuardOnTab(tabId, frameId = 0) {
  const { bypassDevtoolsDetect } = await getSettings();
  if (!bypassDevtoolsDetect) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["devtools-guard.js"],
      world: "MAIN",
      injectImmediately: true,
    });
  } catch {
    /* tab chưa sẵn sàng */
  }
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isTargetUrl(details.url)) return;
  injectGuardOnTab(details.tabId, 0);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isTargetUrl(details.url)) return;
  injectGuardOnTab(details.tabId, 0);
});

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Không đọc được file"));
    reader.readAsDataURL(blob);
  });
}

async function downloadText(content, filename, mimeType, saveAs) {
  const blob = new Blob([content], { type: mimeType });
  const url = await blobToDataUrl(blob);

  return chrome.downloads.download({
    url,
    filename,
    saveAs: Boolean(saveAs),
    conflictAction: "uniquify",
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FETCH_ANSWER") {
    (async () => {
      try {
        const settings = await getSettings();
        const apiUrl = message.apiUrl || settings.answerApiUrl || DEFAULT_ANSWER_API;
        const data = await fetchAnswerFromApi(
          message.questionTitle || "",
          message.question,
          apiUrl
        );
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_INSERT") {
    (async () => {
      try {
        const settings = await getSettings();
        const insertApiUrl = message.insertApiUrl || settings.insertApiUrl || DEFAULT_INSERT_API;
        const data = await insertAnswerToApi(message.payload, insertApiUrl);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_SIM_QUIZ_ANSWER") {
    (async () => {
      try {
        const settings = await getSettings();
        const apiUrl =
          message.apiUrl || settings.simQuizAnswerApiUrl || DEFAULT_SIM_QUIZ_ANSWER_API;
        const data = await fetchSimQuizAnswerFromApi(
          message.stimulusTitle || "",
          message.question,
          apiUrl
        );
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_SIM_QUIZ_INSERT") {
    (async () => {
      try {
        const settings = await getSettings();
        const insertApiUrl =
          message.insertApiUrl || settings.simQuizInsertApiUrl || DEFAULT_SIM_QUIZ_INSERT_API;
        const data = await insertSimQuizToApi(message.payload, insertApiUrl);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_SIM_QUIZ_DEBUG") {
    (async () => {
      try {
        const settings = await getSettings();
        const debugApiUrl =
          message.debugApiUrl || settings.simQuizDebugApiUrl || DEFAULT_SIM_QUIZ_DEBUG_API;
        const data = await postSimQuizDebugToApi(message.payload, debugApiUrl);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_SIM_QUIZ_INSERT_BATCH") {
    (async () => {
      try {
        const settings = await getSettings();
        const batchApiUrl =
          message.batchApiUrl ||
          settings.simQuizInsertBatchApiUrl ||
          DEFAULT_SIM_QUIZ_INSERT_BATCH_API;
        const data = await insertSimQuizBatchToApi(message.items, batchApiUrl);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_AUTO_CLICK") {
    (async () => {
      try {
        const settings = await getSettings();
        const userId = message.user_id ?? settings.ncnUserId ?? null;
        if (_sender?.tab?.windowId != null) {
          await chrome.windows
            .update(_sender.tab.windowId, { focused: true })
            .catch(() => {});
          if (_sender.tab.id != null) {
            await chrome.tabs.update(_sender.tab.id, { active: true }).catch(() => {});
          }
        }
        const data = await fetchAutoClick(
          message.x,
          message.y,
          message.clickApiUrl || settings.clickServerUrl,
          userId
        );
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_AUTO_SCROLL") {
    (async () => {
      try {
        const settings = await getSettings();
        const userId = message.user_id ?? settings.ncnUserId ?? null;
        if (_sender?.tab?.windowId != null) {
          await chrome.windows
            .update(_sender.tab.windowId, { focused: true })
            .catch(() => {});
        }
        const data = await fetchAutoScroll(
          message.x,
          message.y,
          message.amount,
          userId
        );
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_AUTO_TYPE") {
    (async () => {
      try {
        const settings = await getSettings();
        const userId = message.user_id ?? settings.ncnUserId ?? null;
        if (_sender?.tab?.windowId != null) {
          await chrome.windows
            .update(_sender.tab.windowId, { focused: true })
            .catch(() => {});
        }
        const data = await fetchAutoType(
          message.text,
          message.x,
          message.y,
          message.clear_first === true,
          userId
        );
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_SIMULATION_ANSWER") {
    (async () => {
      try {
        const url = message.apiUrl || DEFAULT_SIMULATION_ANSWER_API;
        const data = await postJson(url, {
          situationTitle: message.situationTitle || "",
          situationQuestion: message.situationQuestion,
        });
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_SIMULATION_INSERT") {
    (async () => {
      try {
        const url = message.apiUrl || DEFAULT_SIMULATION_INSERT_API;
        const data = await postJson(url, {
          situationTitle: message.situationTitle || "",
          situationQuestion: message.situationQuestion,
          stopSecond: message.stopSecond,
          stopPercent: message.stopPercent,
          videoDuration: message.videoDuration,
          markColor: message.markColor,
        });
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "FETCH_CHECK_STOP") {
    (async () => {
      try {
        const res = await fetch("http://127.0.0.1:8765/check-stop");
        const data = await res.json().catch(() => ({}));
        sendResponse({ ok: true, stop: data?.stop === true });
      } catch {
        sendResponse({ ok: true, stop: false });
      }
    })();
    return true;
  }

  if (message?.type === "FOCUS_WINDOW") {
    // Chrome window + OS foreground — mỗi profile Chrome là 1 process riêng.
    (async () => {
      try {
        const settings = await getSettings();
        const userId = message.user_id ?? settings.ncnUserId ?? null;
        const windowId = _sender?.tab?.windowId ?? message.windowId;
        if (windowId != null) {
          await chrome.windows.update(windowId, { focused: true }).catch(() => {});
          const tabId = _sender?.tab?.id ?? message.tabId;
          if (tabId != null) {
            await chrome.tabs.update(tabId, { active: true }).catch(() => {});
          }
        }
        await focusOsUserWindow(userId);
        sendResponse({ ok: true, user_id: userId });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "SAVE_EXPORT") {
    (async () => {
      try {
        const settings = await getSettings();
        const filename = buildFilename(settings, message.kind, message.pageTitle);
        const mime = message.kind === "scripts" ? "application/json" : "text/html;charset=utf-8";
        const downloadId = await downloadText(message.content, filename, mime, settings.saveAsDialog);
        sendResponse({ ok: true, downloadId, filename });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "TELEGRAM_NOTIFY") {
    (async () => {
      try {
        const tabUrl = _sender?.tab?.url || message.pageUrl || "";
        const res = await forwardNotifyToAutoPy({
          event: message.event,
          userId: message.userId,
          userName: message.userName,
          practiceRound: message.practiceRound,
          maxRounds: message.maxRounds,
          message: message.message,
          pageUrl: tabUrl,
        });
        sendResponse({ ok: true, ...res });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "stop-all-loops") {
    fetch(`${AUTO_PY_BASE}/stop-all`, { method: "GET" }).catch(() => {});
    const tabs = await chrome.tabs.query({ url: "https://namcaonguyen.huelms.com/*" });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "STOP_ALL" }).catch(() => {});
      }
    }
  }
});
