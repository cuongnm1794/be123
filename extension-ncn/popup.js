import { scriptsPayload } from "./export.js";

const TARGET_HOST = "namcaonguyen.huelms.com";

const btnLookup = document.getElementById("btn-lookup");
const btnPushResult = document.getElementById("btn-push-result");
const btnServerOne = document.getElementById("btn-server-one");
const btnServerLoop = document.getElementById("btn-server-loop");
const btnPracticeX3 = document.getElementById("btn-practice-x3");
const practiceX3Status = document.getElementById("practice-x3-status");
const btnSimQuizAuto = document.getElementById("btn-sim-quiz-auto");
const chkAutoLookup = document.getElementById("chk-auto-lookup");
const btnHtml = document.getElementById("btn-html");
const btnScripts = document.getElementById("btn-scripts");
const btnBoth = document.getElementById("btn-both");
const statusEl = document.getElementById("status");
const siteWarning = document.getElementById("site-warning");
const openOptions = document.getElementById("open-options");

const actionButtons = [
  btnLookup,
  btnPushResult,
  btnServerOne,
  btnServerLoop,
  btnPracticeX3,
  btnSimQuizAuto,
  btnHtml,
  btnScripts,
  btnBoth,
];

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  statusEl.style.whiteSpace = "pre-wrap";
}

function setBusy(busy) {
  for (const btn of actionButtons) {
    btn.disabled = busy;
  }
  chkAutoLookup.disabled = busy;
}

function updateServerLoopButton(running) {
  btnServerLoop.textContent = running ? "Dừng auto server" : "Auto server";
  btnServerLoop.classList.toggle("loop-stop", running);
}

function updateSimQuizLoopButton(running) {
  btnSimQuizAuto.textContent = running
    ? "Dừng auto mô phỏng quiz"
    : "Auto mô phỏng quiz";
  btnSimQuizAuto.classList.toggle("loop-stop", running);
}

function updatePracticeX3Button(running, status = null) {
  btnPracticeX3.textContent = running
    ? "Dừng Auto server (3 lần)"
    : "Auto server (3 lần)";
  btnPracticeX3.classList.toggle("practice-x3-stop", running);
  if (!running) {
    practiceX3Status.textContent = "";
    return;
  }
  const round = status?.practiceRound ?? 0;
  const max = status?.maxPracticeRounds ?? 3;
  practiceX3Status.textContent = `Lượt ${round}/${max} — Ctrl+F8 dừng.`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isTargetUrl(url) {
  try {
    return new URL(url).hostname === TARGET_HOST;
  } catch {
    return false;
  }
}

async function ensureContentScripts(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PAGE_READ_ONLY_STATUS" });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "xpath-click.js",
        "alert-sound.js",
        "ncn-log.js",
        "profile-map.js",
        "auto-answer.js",
        "simulation-auto.js",
        "simulation-quiz-auto.js",
        "auto-learn.js",
        "auto-flow.js",
        "content.js",
      ],
    });
  }
}

async function sendToTab(tabId, payload) {
  await ensureContentScripts(tabId);
  return chrome.tabs.sendMessage(tabId, payload);
}

async function requireTargetTab() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("Không tìm thấy tab.", true);
    return null;
  }
  if (!isTargetUrl(tab.url || "")) {
    setStatus("Chỉ hoạt động trên namcaonguyen.huelms.com", true);
    return null;
  }
  return tab;
}

async function queryServerLoopStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "SERVER_LOOP_STATUS" });
  } catch {
    return { running: false };
  }
}

async function queryPracticeRoundsStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "PRACTICE_ROUNDS_STATUS" });
  } catch {
    return { ok: false, running: false };
  }
}

async function toggleServerLoop() {
  const tab = await requireTargetTab();
  if (!tab) return;

  try {
    const res = await sendToTab(tab.id, { type: "SERVER_LOOP_TOGGLE" });
    if (!res?.ok) throw new Error(res?.error || "Không bật được auto server");

    if (res.stopping) {
      setStatus("Đang dừng sau câu hiện tại…");
      updateServerLoopButton(true);
      return;
    }

    if (res.started) {
      updateServerLoopButton(true);
      setStatus("Auto server đang chạy — bấm lại để dừng.");
      return;
    }

    const status = await queryServerLoopStatus(tab.id);
    updateServerLoopButton(status.running);
  } catch (err) {
    setStatus(err?.message || "Lỗi auto server.", true);
  }
}

async function togglePracticeRounds() {
  const tab = await requireTargetTab();
  if (!tab) return;

  try {
    const { ncnUserId, practiceRounds } = await chrome.storage.sync.get({
      ncnUserId: 1,
      practiceRounds: 3,
    });
    const userId = Math.max(1, Number(ncnUserId) || 1);
    const maxRounds = Math.max(1, Number(practiceRounds) || 3);
    const res = await sendToTab(tab.id, {
      type: "PRACTICE_ROUNDS_TOGGLE",
      userId,
      maxRounds,
    });
    if (!res?.ok) throw new Error(res?.error || "Không bật được Auto server (3 lần)");

    const st = await queryPracticeRoundsStatus(tab.id);
    updatePracticeX3Button(st.running === true, st.status);
    setStatus(
      st.running
        ? `Auto server ${maxRounds} lượt — mở trang chọn chủ đề.`
        : "Đã dừng Auto server (3 lần)."
    );
  } catch (err) {
    setStatus(err?.message || "Lỗi Auto server (3 lần).", true);
  }
}

async function toggleSimQuizLoop() {
  const tab = await requireTargetTab();
  if (!tab) return;

  try {
    const res = await sendToTab(tab.id, { type: "SIMULATION_QUIZ_LOOP_TOGGLE" });
    if (!res?.ok) throw new Error(res?.error || "Không đổi được auto mô phỏng quiz");

    if (res.stopping) {
      setStatus("Đang dừng auto mô phỏng quiz…");
      updateSimQuizLoopButton(true);
      return;
    }

    if (res.started) {
      updateSimQuizLoopButton(true);
      setStatus("Auto mô phỏng quiz — video → đáp án → Kiểm tra → DB.");
      return;
    }

    const status = await chrome.tabs.sendMessage(tab.id, {
      type: "SIMULATION_QUIZ_LOOP_STATUS",
    });
    updateSimQuizLoopButton(status.running);
  } catch (err) {
    setStatus(err?.message || "Lỗi auto mô phỏng quiz.", true);
  }
}

async function runLookup() {
  const tab = await requireTargetTab();
  if (!tab) return;

  setBusy(true);
  setStatus("Đang tra index…");

  try {
    const res = await sendToTab(tab.id, { type: "LOOKUP_ANSWER" });
    if (!res?.ok) throw new Error(res?.error || "Tra index thất bại");
  } catch (err) {
    setStatus(err?.message || "Lỗi tra index.", true);
  } finally {
    setBusy(false);
  }
}

async function runPushResult() {
  const tab = await requireTargetTab();
  if (!tab) return;

  setBusy(true);
  setStatus("Đọc kết quả trang → gửi BE…");

  try {
    const res = await sendToTab(tab.id, { type: "PUSH_RESULT" });
    if (!res?.ok) throw new Error(res?.error || "Gửi kết thất bại");
    if (res.message) setStatus(res.message);
  } catch (err) {
    setStatus(err?.message || "Lỗi gửi kết.", true);
  } finally {
    setBusy(false);
  }
}

async function runServerOne() {
  const tab = await requireTargetTab();
  if (!tab) return;

  setBusy(true);
  setStatus("Click đúng + Tiếp (server)…");

  try {
    const res = await sendToTab(tab.id, { type: "SERVER_CLICK_ONE" });
    if (!res?.ok) throw new Error(res?.error || "Server click thất bại");
    if (res.message) setStatus(res.message);
  } catch (err) {
    setStatus(err?.message || "Lỗi server click.", true);
  } finally {
    setBusy(false);
  }
}

async function toggleAutoLookup() {
  const tab = await requireTargetTab();
  if (!tab) return;

  const enabled = chkAutoLookup.checked;
  try {
    const res = await sendToTab(tab.id, {
      type: "AUTO_LOOKUP_TOGGLE",
      enabled,
    });
    if (!res?.ok) throw new Error(res?.error || "Không đổi được tra index");
    chkAutoLookup.checked = res.enabled !== false;
    setStatus(res.enabled ? "Tự tra index: bật" : "Tự tra index: tắt");
  } catch (err) {
    chkAutoLookup.checked = !enabled;
    setStatus(err?.message || "Lỗi tra index tự động.", true);
  }
}

async function runExportOnTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["export-runner.js"],
  });
  return result;
}

async function saveExport(kind, content, pageTitle) {
  return chrome.runtime.sendMessage({
    type: "SAVE_EXPORT",
    kind,
    content,
    pageTitle,
  });
}

async function exportKind(kind) {
  const tab = await requireTargetTab();
  if (!tab) return;

  setBusy(true);
  setStatus("Đang thu thập mã nguồn…");

  try {
    const data = await runExportOnTab(tab.id);

    if (kind === "html" || kind === "both") {
      const res = await saveExport("html", data.html, data.title);
      if (!res?.ok) throw new Error(res?.error || "Lưu HTML thất bại");
      setStatus(`Đã lưu HTML: ${res.filename}`);
    }

    if (kind === "scripts" || kind === "both") {
      const payload = scriptsPayload(data);
      const res = await saveExport("scripts", payload, data.title);
      if (!res?.ok) throw new Error(res?.error || "Lưu scripts thất bại");
      setStatus(
        kind === "both"
          ? "Đã lưu HTML và scripts."
          : `Đã lưu scripts: ${res.filename}`
      );
    }
  } catch (err) {
    setStatus(err?.message || "Có lỗi khi xuất.", true);
  } finally {
    setBusy(false);
  }
}

async function init() {
  const tab = await getActiveTab();
  if (!isTargetUrl(tab?.url || "")) {
    siteWarning.textContent =
      "Mở trang https://namcaonguyen.huelms.com/ rồi bấm lại extension.";
    siteWarning.classList.remove("hidden");
  }

  if (tab?.id && isTargetUrl(tab.url || "")) {
    try {
      await ensureContentScripts(tab.id);
      const page = await chrome.tabs.sendMessage(tab.id, {
        type: "PAGE_READ_ONLY_STATUS",
      });
      if (page?.ok) {
        chkAutoLookup.checked = page.autoLookup !== false;
        updateServerLoopButton(page.serverLoop === true);
      }
      const loopStatus = await queryServerLoopStatus(tab.id);
      updateServerLoopButton(loopStatus.running);
      try {
        const simQuizStatus = await chrome.tabs.sendMessage(tab.id, {
          type: "SIMULATION_QUIZ_LOOP_STATUS",
        });
        updateSimQuizLoopButton(simQuizStatus.running);
      } catch {}
      try {
        const practiceStatus = await queryPracticeRoundsStatus(tab.id);
        if (practiceStatus?.ok) {
          updatePracticeX3Button(practiceStatus.running === true, practiceStatus.status);
        }
      } catch {}
    } catch {
      /* tab chưa sẵn sàng */
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "PAGE_STATUS" && msg.text) {
      setStatus(msg.text, msg.error === true);
    }
    if (msg?.type === "SERVER_LOOP_PROGRESS" && msg.text) {
      setStatus(msg.text);
      if (typeof msg.running === "boolean") {
        updateServerLoopButton(msg.running);
      }
    }
    if (msg?.type === "SERVER_LOOP_STOPPED") {
      updateServerLoopButton(false);
      if (msg.text) setStatus(msg.text);
    }
    if (msg?.type === "QUESTION_NOT_FOUND_ALERT") {
      setStatus("Chưa có trong DB — đã kêu chuông!", true);
    }
    if (msg?.type === "SIMULATION_QUIZ_LOOP_PROGRESS" && msg.text) {
      setStatus(msg.text, msg.error === true);
      if (typeof msg.running === "boolean") {
        updateSimQuizLoopButton(msg.running);
      }
    }
    if (msg?.type === "SIMULATION_QUIZ_LOOP_STOPPED") {
      updateSimQuizLoopButton(false);
      if (msg.text) setStatus(msg.text);
    }
    if (msg?.type === "AUTO_FLOW_PROGRESS" && msg.text) {
      setStatus(msg.text);
      if (msg.mode === "practice" && typeof msg.running === "boolean") {
        updatePracticeX3Button(msg.running === true, {
          practiceRound: msg.practiceRound,
          maxPracticeRounds: msg.maxRounds,
        });
      }
    }
    if (msg?.type === "DEVTOOLS_SUSPICION_DETECTED" && msg.text) {
      setStatus(msg.text, true);
      updatePracticeX3Button(false);
      updateSimQuizLoopButton(false);
    }
  });

  btnLookup.addEventListener("click", () => runLookup());
  btnPushResult.addEventListener("click", () => runPushResult());
  btnServerOne.addEventListener("click", () => runServerOne());
  btnServerLoop.addEventListener("click", () => toggleServerLoop());
  btnPracticeX3.addEventListener("click", () => togglePracticeRounds());
  btnSimQuizAuto.addEventListener("click", () => toggleSimQuizLoop());
  chkAutoLookup.addEventListener("change", () => toggleAutoLookup());

  btnHtml.addEventListener("click", () => exportKind("html"));
  btnScripts.addEventListener("click", () => exportKind("scripts"));
  btnBoth.addEventListener("click", () => exportKind("both"));

  openOptions.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
