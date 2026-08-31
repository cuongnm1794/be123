/**
 * Auto học: home → khóa chưa đạt (Chưa đạt) → 1-phan → "Xem giáo trình" → xem-giao-trinh.
 *
 * Chỉ đọc DOM + điều hướng location.href — KHÔNG click/scroll script (giữ PAGE_READ_ONLY).
 * Trên trang bài học (xem-giao-trinh) đọc "Thời gian đã học hôm nay X/Y giờ",
 * dừng khi đạt mục tiêu giờ/ngày (mặc định 9h). Định kỳ gửi FOCUS_WINDOW để
 * site tính giờ (site chỉ tính khi cửa sổ ở trên cùng).
 */
(function () {
  const MODULE_KEY = "NCN_AUTO_LEARN";
  const STORAGE_KEY = "ncnAutoLearnRunning";
  const SETTINGS_KEY = "autoLearnTargetHours";

  const DEFAULT_POLL_MS = 10_000;
  const IDLE_POLL_MS = 30_000;
  const FOCUS_EVERY_MS = 30_000;

  const state = {
    running: false,
    stopRequested: false,
    timer: null,
    focusTimer: null,
    lastHours: null,
    targetHours: 9,
    startedAt: 0,
  };

  function nowTime() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function log(message, detail) {
    try {
      window.NCN_LOG?.log("learn", message, detail);
    } catch {
      /* module log chưa sẵn sàng */
    }
  }

  function getStorage(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function setStorage(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  function isTargetHost() {
    try {
      return location.hostname === "namcaonguyen.huelms.com";
    } catch {
      return false;
    }
  }

  function normalizeText(t) {
    return String(t || "").replace(/\s+/g, " ").trim();
  }

  /** Đọc "Thời gian đã học hôm nay X/Y giờ" trên trang bài học. */
  function readStudyHours() {
    const spans = document.querySelectorAll("span");
    for (const s of spans) {
      const t = normalizeText(s.textContent);
      const m = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*giờ/i);
      if (m) {
        return { studied: parseFloat(m[1]), target: parseInt(m[2], 10) };
      }
    }
    const bodyText = document.body ? document.body.innerText : "";
    const m2 = bodyText.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*giờ/i);
    if (m2) {
      return { studied: parseFloat(m2[1]), target: parseInt(m2[2], 10) };
    }
    return null;
  }

  /** Trang bài học (xem-giao-trinh): có header "Thời gian đã học hôm nay". */
  function isStudyPage() {
    return Boolean(
      document.body &&
        document.body.innerText.includes("Thời gian đã học hôm nay")
    );
  }

  /** Tìm link "Xem giáo trình" trên trang phần (1-phan). */
  function findXemGiaoTrinhLink() {
    const links = document.querySelectorAll("a[href]");
    for (const a of links) {
      if (normalizeText(a.textContent) === "Xem giáo trình") {
        const href = a.getAttribute("href");
        if (href) return new URL(href, location.href).href;
      }
    }
    return null;
  }

  /** Trên home: tìm khóa chưa đạt (Chưa đạt) → link khóa. */
  function findUnfinishedCourseLink() {
    const table = document.querySelector(".learn-table-default");
    if (!table) return null;
    const rows = table.querySelectorAll("tr.ant-table-row");
    for (const row of rows) {
      if (!(row.textContent || "").includes("Chưa đạt")) continue;
      const a = row.querySelector("a.course-info__name[href]");
      if (a) return new URL(a.getAttribute("href"), location.href).href;
    }
    return null;
  }

  function pageType() {
    if (isStudyPage()) return "study";
    if (findXemGiaoTrinhLink()) return "part";
    if (findUnfinishedCourseLink()) return "home";
    return "unknown";
  }

  function broadcast(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  function report(text, extra = {}) {
    log(text);
    broadcast({
      type: "AUTO_LEARN_PROGRESS",
      running: state.running,
      text,
      hours: state.lastHours,
      ...extra,
    });
  }

  async function focusWindow() {
    try {
      const { ncnUserId } = await chrome.storage.sync.get({ ncnUserId: 1 });
      const res = await chrome.runtime.sendMessage({
        type: "FOCUS_WINDOW",
        user_id: Math.max(1, Number(ncnUserId) || 1),
      });
      return res?.ok === true;
    } catch {
      return false;
    }
  }

  function scheduleFocus() {
    if (state.focusTimer) clearTimeout(state.focusTimer);
    state.focusTimer = setTimeout(() => {
      if (!state.running || state.stopRequested) return;
      focusWindow();
      scheduleFocus();
    }, FOCUS_EVERY_MS);
  }

  async function tick() {
    if (!state.running || state.stopRequested) return;

    if (!isTargetHost()) {
      scheduleNext(IDLE_POLL_MS);
      return;
    }

    const hours = readStudyHours();
    state.lastHours = hours ? hours.studied : null;

    if (isStudyPage() && hours) {
      report(`Đang học — ${hours.studied}/${hours.target} giờ`, {
        hours: hours.studied,
        target: hours.target,
      });
      if (hours.studied >= state.targetHours) {
        await stop({ reached: true });
        return;
      }
      scheduleNext(DEFAULT_POLL_MS);
      return;
    }

    const gtLink = findXemGiaoTrinhLink();
    if (gtLink) {
      report(`Vào xem giáo trình: ${gtLink}`);
      location.href = gtLink;
      return;
    }

    const courseLink = findUnfinishedCourseLink();
    if (courseLink) {
      report(`Mở khóa chưa đạt: ${courseLink}`);
      location.href = courseLink;
      return;
    }

    report("Chưa tìm thấy khóa/bài để học — chờ 30s", {
      hours: state.lastHours,
    });
    scheduleNext(IDLE_POLL_MS);
  }

  function scheduleNext(delayMs = DEFAULT_POLL_MS) {
    if (!state.running || state.stopRequested) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(tick, delayMs);
  }

  async function start(options = {}) {
    if (state.running) return { ok: true, alreadyRunning: true };
    const settings = await getStorage({ [SETTINGS_KEY]: 9 });
    state.targetHours =
      Number(options.targetHours) ||
      Number(settings[SETTINGS_KEY]) ||
      9;
    state.running = true;
    state.stopRequested = false;
    state.startedAt = Date.now();
    await setStorage({ [STORAGE_KEY]: true });
    report(`Auto học bắt đầu — mục tiêu ${state.targetHours} giờ/ngày`);
    scheduleFocus();
    scheduleNext(500);
    return { ok: true, running: true };
  }

  async function stop(options = {}) {
    state.running = false;
    state.stopRequested = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.focusTimer) {
      clearTimeout(state.focusTimer);
      state.focusTimer = null;
    }
    await setStorage({ [STORAGE_KEY]: false });
    report(
      options.reached
        ? `Đạt ${state.targetHours} giờ/ngày — dừng.`
        : "Đã dừng auto học."
    );
    return { ok: true, running: false };
  }

  function status() {
    return {
      running: state.running,
      hours: state.lastHours,
      target: state.targetHours,
      startedAt: state.startedAt,
      page: pageType(),
    };
  }

  async function init() {
    const data = await getStorage({ [STORAGE_KEY]: false });
    if (data[STORAGE_KEY] && isTargetHost()) {
      start();
    }
  }

  window.NCN_AUTO_LEARN = {
    start,
    stop,
    status,
    readStudyHours,
    isStudyPage,
    findXemGiaoTrinhLink,
    findUnfinishedCourseLink,
  };

  init();
})();