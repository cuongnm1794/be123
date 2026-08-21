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
const DEFAULT_SIMULATION_ANSWER_API = "http://localhost:3003/api/simulation/answer";
const DEFAULT_SIMULATION_INSERT_API = "http://localhost:3003/api/simulation/insert";

async function getSettings() {
  return chrome.storage.sync.get({
    subfolder: "namcaonguyen-sources",
    includeTimestamp: true,
    saveAsDialog: false,
    showFloatingBar: false,
    bypassDevtoolsDetect: true,
    answerApiUrl: DEFAULT_ANSWER_API,
    insertApiUrl: DEFAULT_INSERT_API,
    clickServerUrl: DEFAULT_CLICK_API,
  });
}

function buildClickServerUrl(clickApiUrl, x, y) {
  const raw = (clickApiUrl || DEFAULT_CLICK_API).trim();
  const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
  u.searchParams.set("x", String(Math.round(x)));
  u.searchParams.set("y", String(Math.round(y)));
  return u.toString();
}

async function fetchAutoClick(x, y, clickApiUrl) {
  const url = buildClickServerUrl(clickApiUrl, x, y);
  const res = await fetch(url, { method: "GET" });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Click server ${res.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
  }
  return { url, body: text };
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

  if (message?.type === "FETCH_AUTO_CLICK") {
    (async () => {
      try {
        const settings = await getSettings();
        const data = await fetchAutoClick(
          message.x,
          message.y,
          message.clickApiUrl || settings.clickServerUrl
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

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "stop-all-loops") {
    const tabs = await chrome.tabs.query({ url: "https://namcaonguyen.huelms.com/*" });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "STOP_ALL" }).catch(() => {});
      }
    }
  }
});

// ═══════════════ Hermes Bridge Command Polling ═══════════════
const BRIDGE_URL = 'http://127.0.0.1:9877';
let _hermesLastCmdId = 0;
let _hermesPollTimer = null;

async function _hermesPollCommands() {
  try {
    const resp = await fetch(`${BRIDGE_URL}/command?since=${_hermesLastCmdId}`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data.commands || !data.commands.length) return;

    for (const cmd of data.commands) {
      _hermesLastCmdId = Math.max(_hermesLastCmdId, cmd.id);
      await _hermesHandleCommand(cmd);
    }
  } catch (e) {
    // bridge not running, ignore
  }
}

async function _hermesHandleCommand(cmd) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return;

  const status = { running: true, command: cmd.action, ts: Date.now() };

  switch (cmd.action) {
    case 'auto_answer_start':
      await chrome.tabs.sendMessage(tabId, { action: 'startAutoAnswer' }).catch(() => {});
      break;
    case 'auto_answer_stop':
      await chrome.tabs.sendMessage(tabId, { action: 'stopAutoAnswer' }).catch(() => {});
      status.running = false;
      break;
    case 'simulation_start':
      await chrome.tabs.sendMessage(tabId, { action: 'startSimulation' }).catch(() => {});
      break;
    case 'simulation_stop':
      await chrome.tabs.sendMessage(tabId, { action: 'stopSimulation' }).catch(() => {});
      status.running = false;
      break;
  }

  // report status back
  try {
    await fetch(`${BRIDGE_URL}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: cmd.action.replace('_start', '').replace('_stop', ''),
        status }),
    });
  } catch (e) { /* ignore */ }
}

// Start polling
_hermesPollTimer = setInterval(_hermesPollCommands, 2000);
console.log('[Hermes Bridge] Command polling started on', BRIDGE_URL);
