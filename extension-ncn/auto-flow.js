/**
 * Auto flow đầy đủ: login → home (Chưa đạt) → khóa → giáo trình / ôn luyện.
 * Phân bổ theo % tiến độ "Số giờ" trên trang phần học (vd. 8.3/12 > 40% → ôn luyện).
 * Chỉ đọc DOM + server click/type — không click DOM trực tiếp.
 */
(function () {
  const STORAGE_KEY = "ncnAutoFlowRunning";
  const FLOW_SETTINGS_KEY = "autoFlowSettings";

  const POLL_MS = 3_000;
  const IDLE_POLL_MS = 8_000;
  const NAV_WAIT_MS = 4_000;
  const FOCUS_EVERY_MS = 25_000;
  const CHECK_TASK_HOURS_MS = 45_000;
  const DEFAULT_PRACTICE_ROUNDS = 3;
  const LOGIN_URL = "https://namcaonguyen.huelms.com/user/login";
  const HOME_URL = "https://namcaonguyen.huelms.com/my/home";

  const state = {
    running: false,
    stopRequested: false,
    timer: null,
    focusTimer: null,
    phase: "idle",
    userId: null,
    taskProgress: null,
    lastTaskHoursCheck: 0,
    serverLoopRunning: false,
    scrollLoopRunning: false,
    lastReport: "",
    practiceRound: 0,
    maxPracticeRounds: DEFAULT_PRACTICE_ROUNDS,
    awaitingPracticeRestart: false,
    lastHandledServerLoopCount: 0,
    mode: "idle",
  };

  function normalizeText(t) {
    return String(t || "").replace(/\s+/g, " ").trim();
  }

  function log(message, detail) {
    try {
      window.NCN_LOG?.log("flow", message, detail);
    } catch {
      /* ignore */
    }
  }

  function getStorage(keys) {
    return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
  }

  function setStorageLocal(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  function isTargetHost() {
    try {
      return location.hostname === "namcaonguyen.huelms.com";
    } catch {
      return false;
    }
  }

  async function checkStopFlag() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "FETCH_CHECK_STOP" });
      return res?.stop === true;
    } catch {
      return false;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function report(text, extra = {}) {
    state.lastReport = text;
    log(text);
    safeSendMessage({
      type: "AUTO_FLOW_PROGRESS",
      running: state.running,
      phase: state.phase,
      mode: state.mode,
      practiceRound: state.practiceRound,
      maxRounds: state.maxPracticeRounds,
      text,
      ...extra,
    });
  }

  function safeSendMessage(message) {
    if (window.NCN_RUNTIME?.safeSendMessage) {
      return window.NCN_RUNTIME.safeSendMessage(message);
    }
    try {
      return chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  function notifyTelegram(event, detail = {}) {
    safeSendMessage({
      type: "TELEGRAM_NOTIFY",
      event,
      userId: state.userId,
      pageUrl: location.href,
      ...detail,
    });
  }

  function readStudyHours() {
    if (window.NCN_AUTO_LEARN?.readStudyHours) {
      return window.NCN_AUTO_LEARN.readStudyHours();
    }
    const bodyText = document.body ? document.body.innerText : "";
    const m = bodyText.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*giờ/i);
    if (m) {
      return { studied: parseFloat(m[1]), target: parseInt(m[2], 10) };
    }
    return null;
  }

  function parseHoursFraction(text) {
    const m = normalizeText(text).match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const studied = parseFloat(m[1]);
    const required = parseFloat(m[2]);
    if (!Number.isFinite(studied) || !Number.isFinite(required) || required <= 0) {
      return null;
    }
    return {
      studied,
      required,
      percent: (studied / required) * 100,
    };
  }

  function parseHoursCell(cell) {
    if (!cell) return null;
    const valueEl = cell.querySelector(".total-point__value");
    if (valueEl) {
      const studied = parseFloat(valueEl.textContent);
      const tail = cell.textContent || "";
      const m = tail.match(/\/\s*(\d+(?:\.\d+)?)/);
      const required = m ? parseFloat(m[1]) : NaN;
      if (!Number.isFinite(studied) || !Number.isFinite(required) || required <= 0) {
        return null;
      }
      return { studied, required, percent: (studied / required) * 100 };
    }
    return parseHoursFraction(cell.textContent);
  }

  /** Đọc bảng nhiệm vụ trên trang phần học: "Xem giáo trình" 8.3/12, "Ôn luyện" … */
  function readCourseTaskHours() {
    const tasks = {};
    for (const row of document.querySelectorAll("tr.ant-table-row")) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) continue;
      const nameCell = cells[0];
      const hourCell = cells[1];
      const link = nameCell.querySelector("a[href]");
      const name = normalizeText(link?.textContent || nameCell.textContent);
      if (!name) continue;
      const hours = parseHoursCell(hourCell);
      if (!hours) continue;
      tasks[name] = {
        ...hours,
        linkEl: link || null,
        row,
      };
    }
    return Object.keys(tasks).length ? tasks : null;
  }

  function isCourseSectionPage() {
    const tasks = readCourseTaskHours();
    return Boolean(tasks?.["Xem giáo trình"] || tasks?.["Ôn luyện"]);
  }

  function getCourseDashboardUrl() {
    const dash = document.querySelector('a[href*="/student/course/"][href*="/dashboard"]');
    if (dash?.href) return new URL(dash.href, location.href).href;
    const m1 = location.pathname.match(/\/student\/course\/(\d+)/);
    if (m1) return `${location.origin}/student/course/${m1[1]}/dashboard`;
    const m2 = location.pathname.match(/\/learn\/course\/learn\/(\d+)/);
    if (m2) return `${location.origin}/student/course/${m2[1]}/dashboard`;
    return null;
  }

  function decideCoursePhase(settings, tasks) {
    const curriculumThreshold = Number(settings.curriculumPercent) || 40;
    const practiceThreshold = Number(settings.practicePercent) || 60;
    const gt = tasks?.["Xem giáo trình"] || null;
    const ol = tasks?.["Ôn luyện"] || null;
    const gtPercent = gt?.percent ?? 0;
    const olPercent = ol?.percent ?? 0;

    if (gt && gtPercent < curriculumThreshold) {
      return {
        phase: "curriculum",
        gt,
        ol,
        gtPercent,
        olPercent,
        curriculumThreshold,
        practiceThreshold,
      };
    }
    if (ol && olPercent < practiceThreshold) {
      return {
        phase: "practice_select",
        gt,
        ol,
        gtPercent,
        olPercent,
        curriculumThreshold,
        practiceThreshold,
      };
    }
    return {
      phase: "done",
      gt,
      ol,
      gtPercent,
      olPercent,
      curriculumThreshold,
      practiceThreshold,
    };
  }

  function formatTaskHours(task) {
    if (!task) return "?";
    return `${task.studied}/${task.required} (${task.percent.toFixed(1)}%)`;
  }

  async function navigateToCourseDashboardIfNeeded() {
    if (isCourseSectionPage()) return false;
    const url = getCourseDashboardUrl();
    if (!url) return false;
    location.href = url;
    return true;
  }

  function isLoginPage() {
    return (
      /\/user\/login/i.test(location.pathname) ||
      Boolean(document.querySelector('input[name="login"], input[name="password"]'))
    );
  }

  function isHomePage() {
    return (
      /\/my\/home/i.test(location.pathname) ||
      Boolean(document.querySelector(".learn-table-default"))
    );
  }

  function isStudyCurriculumPage() {
    return Boolean(
      document.body?.innerText.includes("Thời gian đã học hôm nay") ||
        document.querySelector('.learn-name__text[title="Tài liệu đọc"]')
    );
  }

  function isQuizPage() {
    if (isPracticeSelectPage()) return false;
    return Boolean(
      document.querySelector(".question-panel") ||
        document.querySelector('.learn-name__text[title="Ôn luyện"]')
    );
  }

  function isPracticeSelectPage() {
    const bodyText = normalizeText(document.body?.innerText || "");
    return Boolean(
      document.querySelector(".practice-contests") ||
        bodyText.includes("Luyện tất cả") ||
        bodyText.includes("Tổng số câu hỏi")
    );
  }

  /** Popup nghi ngờ DevTools — site yêu cầu giải captcha thủ công. */
  function isDevtoolsSuspicionPopup() {
    const keyword = /devtools?/i;
    const isVisible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
    };

    for (const el of document.querySelectorAll(
      ".ant-modal-wrap, .ant-modal, .ant-modal-confirm, [role='dialog'], .ant-notification-notice"
    )) {
      if (!isVisible(el)) continue;
      const text = normalizeText(el.textContent);
      if (keyword.test(text)) return true;
    }
    return false;
  }

  async function handleDevtoolsSuspicion() {
    if (!isDevtoolsSuspicionPopup()) return false;
    await stopLoops();
    await stop({
      reason: "devtools_captcha",
      text: `User ${state.userId}: popup nghi ngờ DevTools — dừng, cần giải captcha thủ công.`,
    });
    try {
      window.NCN_ALERT?.playNotFoundChimes?.();
    } catch {
      /* ignore */
    }
    chrome.runtime
      .sendMessage({
        type: "DEVTOOLS_SUSPICION_DETECTED",
        text: state.lastReport,
        userId: state.userId,
      })
      .catch(() => {});
    notifyTelegram("devtools_suspicion", {
      message: `Popup nghi ngờ DevTools — dừng acc, cần giải captcha thủ công.`,
    });
    return true;
  }

  function findLuyenTatCaButton() {
    return (
      findLinkByExactText("Luyện tất cả") ||
      findContainsLink("Luyện tất cả") ||
      [...document.querySelectorAll("button")].find((btn) =>
        /luyện\s+tất\s+cả/i.test(normalizeText(btn.textContent))
      ) ||
      null
    );
  }

  async function clickLuyenTatCa() {
    const btn = findLuyenTatCaButton();
    if (!btn) return false;
    report("Click Luyện tất cả…");
    await serverClickElement(btn);
    state.phase = "practice";
    state.awaitingPracticeRestart = false;
    return true;
  }

  function onPracticeRoundComplete() {
    state.practiceRound += 1;
    const maxRounds = state.maxPracticeRounds;
    notifyTelegram("practice_round_complete", {
      practiceRound: state.practiceRound,
      maxRounds,
    });
    if (state.practiceRound < maxRounds) {
      report(
        `Hoàn thành lượt ${state.practiceRound}/${maxRounds} — chọn Luyện tất cả tiếp…`
      );
      state.phase = "practice_select";
      state.awaitingPracticeRestart = true;
      return true;
    }
    notifyTelegram("practice_all_complete", { maxRounds });
    report(`Đã xong ${maxRounds} lượt ôn luyện.`);
    state.awaitingPracticeRestart = false;
    return false;
  }

  function finishAfterAllRounds(needMore) {
    if (needMore) return;
    if (state.mode === "practice") {
      state.phase = "done_practice";
      return;
    }
    state.phase = "course";
    const dash = getCourseDashboardUrl();
    if (dash) location.href = dash;
  }

  /** Xử lý khi server loop xong 1 lượt — không phụ thuộc còn ở trang câu hỏi hay không. */
  async function tryHandlePracticeRoundComplete() {
    if (!state.running || state.phase !== "practice") return false;

    const loopStatus = window.NCN_CONTENT_API?.serverLoopStatus?.() || {
      running: false,
      lastNaturalComplete: false,
      count: 0,
    };
    state.serverLoopRunning = loopStatus.running === true;
    if (!loopStatus.lastNaturalComplete) return false;
    if (loopStatus.count <= state.lastHandledServerLoopCount) return false;

    state.lastHandledServerLoopCount = loopStatus.count;
    window.NCN_CONTENT_API?.ackServerLoopComplete?.();
    const needMore = onPracticeRoundComplete();
    finishAfterAllRounds(needMore);
    return true;
  }

  /** Phòng khi đã về màn Tổng số câu hỏi nhưng cờ lastNaturalComplete bị miss. */
  async function tryRecoverPracticeRoundOnSelectPage() {
    if (!state.running || state.phase !== "practice" || !isPracticeSelectPage()) {
      return false;
    }

    const loopStatus = window.NCN_CONTENT_API?.serverLoopStatus?.() || {
      running: false,
      count: 0,
    };
    if (loopStatus.running) return false;
    if (loopStatus.count <= 0 || loopStatus.count <= state.lastHandledServerLoopCount) {
      return false;
    }

    state.lastHandledServerLoopCount = loopStatus.count;
    window.NCN_CONTENT_API?.ackServerLoopComplete?.();
    const needMore = onPracticeRoundComplete();
    finishAfterAllRounds(needMore);
    return true;
  }

  async function handlePracticeSelectPageTick() {
    if (!state.running || !isPracticeSelectPage()) return false;

    if (await tryHandlePracticeRoundComplete()) return true;
    if (await tryRecoverPracticeRoundOnSelectPage()) return true;

    if (state.phase !== "practice_select") {
      if (state.phase === "practice") {
        report("Ở màn Tổng số câu hỏi — chờ xác nhận xong lượt…");
      }
      return false;
    }

    const clicked = await clickLuyenTatCa();
    if (!clicked) {
      report("Chưa thấy Luyện tất cả — chờ…");
      return false;
    }
    return true;
  }

  async function handleServerLoopNaturalComplete() {
    if (!state.running) return false;

    let handled = await tryHandlePracticeRoundComplete();
    if (!handled && isPracticeSelectPage()) {
      handled = await tryRecoverPracticeRoundOnSelectPage();
    }
    if (handled) {
      scheduleNext(NAV_WAIT_MS);
    } else if (isPracticeSelectPage() && state.phase === "practice_select") {
      scheduleNext(NAV_WAIT_MS);
    }
    return handled;
  }

  function findLinkByExactText(text) {
    const want = normalizeText(text);
    for (const el of document.querySelectorAll("a[href], button, [role='button']")) {
      if (normalizeText(el.textContent) === want) return el;
    }
    return null;
  }

  function findContainsLink(text) {
    const want = normalizeText(text).toLowerCase();
    for (const el of document.querySelectorAll("a[href], button")) {
      const t = normalizeText(el.textContent).toLowerCase();
      if (t.includes(want)) return el;
    }
    return null;
  }

  function elementScreenCoords(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      throw new Error("Phần tử không hiển thị.");
    }
    const padX = Math.max(4, rect.width * 0.15);
    const padY = Math.max(4, rect.height * 0.15);
    const clientX = Math.round(
      rect.left + padX + Math.random() * Math.max(1, rect.width - 2 * padX)
    );
    const clientY = Math.round(
      rect.top + padY + Math.random() * Math.max(1, rect.height - 2 * padY)
    );
    const borderLeft = window.outerWidth - window.innerWidth;
    const borderTop = window.outerHeight - window.innerHeight;
    return {
      screenX: Math.round(window.screenX + borderLeft + clientX),
      screenY: Math.round(window.screenY + borderTop + clientY),
    };
  }

  async function serverClickElement(el) {
    const coords = elementScreenCoords(el);
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_AUTO_CLICK",
      x: coords.screenX,
      y: coords.screenY,
      user_id: state.userId,
    });
    if (!res?.ok) throw new Error(res?.error || "Server click thất bại");
    return res;
  }

  async function serverTypeAtElement(el, text, clearFirst = true) {
    const coords = elementScreenCoords(el);
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_AUTO_TYPE",
      x: coords.screenX,
      y: coords.screenY,
      text: String(text),
      clear_first: clearFirst,
      user_id: state.userId,
    });
    if (!res?.ok) throw new Error(res?.error || "Server type thất bại");
    return res;
  }

  async function focusWindow() {
    if (!state.userId) return;
    try {
      await chrome.runtime.sendMessage({
        type: "FOCUS_WINDOW",
        user_id: state.userId,
      });
    } catch {
      /* ignore */
    }
  }

  function scheduleFocus() {
    if (state.focusTimer) clearTimeout(state.focusTimer);
    state.focusTimer = setTimeout(async () => {
      if (!state.running || state.stopRequested) return;
      await focusWindow();
      scheduleFocus();
    }, FOCUS_EVERY_MS);
  }

  async function getFlowSettings() {
    return getStorage({
      ncnUserId: 1,
      defaultPassword: "123456",
      curriculumPercent: 40,
      practicePercent: 60,
      practiceRounds: DEFAULT_PRACTICE_ROUNDS,
    });
  }

  async function resolveCredentials() {
    const settings = await getFlowSettings();
    const userId = Number(settings.ncnUserId) || 1;
    state.userId = userId;
    const profile = window.NCN_PROFILE_MAP?.getProfile(userId);
    const cccd =
      profile?.cccd || window.NCN_PROFILE_MAP?.getCccd(userId) || "";
    const password =
      settings.defaultPassword ||
      window.NCN_PROFILE_MAP?.getDefaultPassword() ||
      "123456";
    if (!cccd) throw new Error(`Chưa có CCCD cho user_id ${userId}`);
    return { userId, cccd, password };
  }

  async function doLogin() {
    state.phase = "login";
    report("Đang đăng nhập…");

    const { cccd, password } = await resolveCredentials();

    const loginInput =
      document.querySelector('input[name="login"]') ||
      document.querySelector('input[type="text"]');
    const passInput =
      document.querySelector('input[name="password"]') ||
      document.querySelector('input[type="password"]');
    const submitBtn =
      document.querySelector('button[type="submit"]') ||
      findContainsLink("đăng nhập") ||
      findContainsLink("Đăng nhập");

    if (!loginInput || !passInput) {
      throw new Error("Không thấy form đăng nhập.");
    }

    await serverClickElement(loginInput);
    await sleep(300);
    await serverTypeAtElement(loginInput, cccd, true);
    await sleep(400);

    await serverClickElement(passInput);
    await sleep(300);
    await serverTypeAtElement(passInput, password, true);
    await sleep(400);

    if (submitBtn) {
      await serverClickElement(submitBtn);
    } else {
      await serverTypeAtElement(passInput, "\n", false);
    }

    await sleep(NAV_WAIT_MS);
    report("Đã gửi form đăng nhập — chờ chuyển trang…");
  }

  function findUnfinishedCourseElement() {
    const table = document.querySelector(".learn-table-default");
    if (!table) return null;
    const rows = table.querySelectorAll("tr.ant-table-row");
    for (const row of rows) {
      if (!(row.textContent || "").includes("Chưa đạt")) continue;
      const a = row.querySelector("a.course-info__name[href]");
      if (a) return a;
    }
    return null;
  }

  function shouldStopCurriculumPhase(settings) {
    const tasks = readCourseTaskHours();
    if (!tasks) return false;
    const decision = decideCoursePhase(settings, tasks);
    state.taskProgress = tasks;
    return decision.phase !== "curriculum";
  }

  function shouldStopPracticePhase(settings) {
    const tasks = readCourseTaskHours();
    if (!tasks) return false;
    const decision = decideCoursePhase(settings, tasks);
    state.taskProgress = tasks;
    return decision.phase === "done";
  }

  async function ensureScrollLoop(on) {
    const api = window.NCN_CONTENT_API;
    if (!api?.toggleScrollLoop) return;
    if (on && !state.scrollLoopRunning) {
      const res = await api.toggleScrollLoop();
      state.scrollLoopRunning = res?.started === true || res?.running === true;
    } else if (!on && state.scrollLoopRunning) {
      await api.toggleScrollLoop();
      state.scrollLoopRunning = false;
    }
  }

  async function ensureServerLoop(on) {
    const api = window.NCN_CONTENT_API;
    if (!api?.toggleServerLoop) return;
    if (on && !state.serverLoopRunning) {
      const res = await api.toggleServerLoop();
      state.serverLoopRunning = res?.started === true || res?.running === true;
    } else if (!on && state.serverLoopRunning) {
      await api.toggleServerLoop();
      state.serverLoopRunning = false;
    }
  }

  async function stopLoops() {
    await ensureScrollLoop(false);
    await ensureServerLoop(false);
  }

  async function tick() {
    if (!state.running || state.stopRequested) return;

    if (!window.NCN_RUNTIME?.isExtensionContextValid?.()) {
      state.running = false;
      state.stopRequested = true;
      if (state.timer) clearTimeout(state.timer);
      if (state.focusTimer) clearTimeout(state.focusTimer);
      return;
    }

    if (await checkStopFlag()) {
      state.stopRequested = true;
      await stop({ reason: "hotkey" });
      return;
    }

    if (!isTargetHost()) {
      scheduleNext(IDLE_POLL_MS);
      return;
    }

    const settings = await getFlowSettings();
    state.maxPracticeRounds =
      Number(settings.practiceRounds) || DEFAULT_PRACTICE_ROUNDS;

    if (await handleDevtoolsSuspicion()) return;

    if (state.mode === "practice") {
      await tickPracticeOnly(settings);
      return;
    }

    if (await tryHandlePracticeRoundComplete()) {
      scheduleNext(NAV_WAIT_MS);
      return;
    }

    if (isLoginPage()) {
      await doLogin();
      scheduleNext(NAV_WAIT_MS);
      return;
    }

    const hours = readStudyHours();
    if (hours && hours.studied >= hours.target) {
      report(`Đã đủ ${hours.target} giờ/ngày — dừng flow.`);
      await stop({ reached: true });
      return;
    }

    if (isHomePage()) {
      state.phase = "home";
      const courseEl = findUnfinishedCourseElement();
      if (!courseEl) {
        report("Không còn khóa Chưa đạt — chờ…");
        scheduleNext(IDLE_POLL_MS);
        return;
      }
      report(`Mở khóa chưa đạt: ${normalizeText(courseEl.textContent)}`);
      await serverClickElement(courseEl);
      scheduleNext(NAV_WAIT_MS);
      return;
    }

    if (isStudyCurriculumPage() && state.phase === "curriculum") {
      const now = Date.now();
      if (now - state.lastTaskHoursCheck >= CHECK_TASK_HOURS_MS) {
        state.lastTaskHoursCheck = now;
        await ensureScrollLoop(false);
        if (await navigateToCourseDashboardIfNeeded()) {
          report("Về trang phần học để kiểm tra Số giờ giáo trình…");
          scheduleNext(NAV_WAIT_MS);
          return;
        }
      }

      if (isCourseSectionPage() && shouldStopCurriculumPhase(settings)) {
        const tasks = state.taskProgress || readCourseTaskHours();
        const gt = tasks?.["Xem giáo trình"];
        report(
          `Giáo trình ${formatTaskHours(gt)} ≥ ${settings.curriculumPercent || 40}% — chuyển ôn luyện.`
        );
        await ensureScrollLoop(false);
        state.phase = "course";
        scheduleNext(POLL_MS);
        return;
      }

      if (isCourseSectionPage() && state.phase === "curriculum") {
        const xemGt =
          readCourseTaskHours()?.["Xem giáo trình"]?.linkEl ||
          findLinkByExactText("Xem giáo trình");
        if (xemGt) {
          report("Tiếp tục Xem giáo trình…");
          await serverClickElement(xemGt);
          scheduleNext(NAV_WAIT_MS);
          return;
        }
      }

      const gt = state.taskProgress?.["Xem giáo trình"];
      report(
        `Treo giáo trình — ${formatTaskHours(gt)} (mục tiêu ${settings.curriculumPercent || 40}%)`
      );
      await ensureScrollLoop(true);
      scheduleNext(POLL_MS);
      return;
    }

    if (isQuizPage() && state.phase === "practice") {
      const loopStatus =
        window.NCN_CONTENT_API?.serverLoopStatus?.() || {
          running: false,
          count: 0,
          lastNaturalComplete: false,
        };
      state.serverLoopRunning = loopStatus.running === true;

      const now = Date.now();
      if (now - state.lastTaskHoursCheck >= CHECK_TASK_HOURS_MS) {
        state.lastTaskHoursCheck = now;
        await ensureServerLoop(false);
        if (await navigateToCourseDashboardIfNeeded()) {
          report("Về trang phần học để kiểm tra Số giờ ôn luyện…");
          scheduleNext(NAV_WAIT_MS);
          return;
        }
      }

      if (isCourseSectionPage()) {
        const decision = decideCoursePhase(settings, readCourseTaskHours());
        state.taskProgress = readCourseTaskHours();
        if (decision.phase === "curriculum") {
          report(`Ôn luyện tạm dừng — giáo trình chưa đủ ${decision.curriculumThreshold}%.`);
          await ensureServerLoop(false);
          state.phase = "course";
          scheduleNext(POLL_MS);
          return;
        }
        if (decision.phase === "done") {
          report(
            `Ôn luyện ${formatTaskHours(decision.ol)} ≥ ${decision.practiceThreshold}% — xong phần học.`
          );
          await ensureServerLoop(false);
          state.phase = "course";
          location.href = HOME_URL;
          scheduleNext(NAV_WAIT_MS);
          return;
        }
        if (decision.phase === "practice_select") {
          const onLuyen = decision.ol?.linkEl || findLinkByExactText("Ôn luyện");
          if (onLuyen) {
            report(`Tiếp tục ôn luyện — ${formatTaskHours(decision.ol)}`);
            await serverClickElement(onLuyen);
            state.phase = "practice_select";
            state.practiceRound = 0;
            state.awaitingPracticeRestart = false;
            scheduleNext(NAV_WAIT_MS);
            return;
          }
        }
      }

      if (!state.serverLoopRunning && !shouldStopPracticePhase(settings)) {
        report("Bật auto server làm bài…");
        await ensureServerLoop(true);
        scheduleNext(POLL_MS);
        return;
      }

      if (shouldStopPracticePhase(settings)) {
        report("Đủ tiến độ ôn luyện — quay lại khóa.");
        await ensureServerLoop(false);
        state.phase = "course";
        const dash = getCourseDashboardUrl();
        if (dash) location.href = dash;
        scheduleNext(NAV_WAIT_MS);
        return;
      }

      report(`Đang làm bài ôn luyện (loop: ${loopStatus?.count ?? 0} câu)…`);
      scheduleNext(POLL_MS);
      return;
    }

    if (
      state.running &&
      state.phase === "practice_select" &&
      state.awaitingPracticeRestart &&
      !isPracticeSelectPage()
    ) {
      report("Chờ về màn hình chọn luyện tập…");
      scheduleNext(POLL_MS);
      return;
    }

    if (isPracticeSelectPage() && state.running) {
      const acted = await handlePracticeSelectPageTick();
      scheduleNext(acted ? NAV_WAIT_MS : POLL_MS);
      return;
    }

    if (isCourseSectionPage()) {
      const tasks = readCourseTaskHours();
      state.taskProgress = tasks;
      state.lastTaskHoursCheck = Date.now();
      const decision = decideCoursePhase(settings, tasks);
      const gt = decision.gt;
      const ol = decision.ol;

      report(
        `Số giờ phần học — GT ${formatTaskHours(gt)} | ÔL ${formatTaskHours(ol)} (ngưỡng ${decision.curriculumThreshold}% / ${decision.practiceThreshold}%)`
      );

      if (decision.phase === "curriculum") {
        const xemGt = gt?.linkEl || findLinkByExactText("Xem giáo trình");
        if (xemGt) {
          state.phase = "curriculum";
          report(`Vào Xem giáo trình — ${formatTaskHours(gt)} < ${decision.curriculumThreshold}%`);
          if (typeof xemGt === "string") {
            location.href = xemGt;
          } else {
            await serverClickElement(xemGt);
          }
          scheduleNext(NAV_WAIT_MS);
          return;
        }
      }

      if (decision.phase === "practice_select") {
        const onLuyen = ol?.linkEl || findLinkByExactText("Ôn luyện");
        if (onLuyen) {
          state.phase = "practice_select";
          state.practiceRound = 0;
          state.awaitingPracticeRestart = false;
          report(`Vào Ôn luyện — GT đủ ${decision.curriculumThreshold}%, ÔL ${formatTaskHours(ol)} < ${decision.practiceThreshold}%`);
          await serverClickElement(onLuyen);
          scheduleNext(NAV_WAIT_MS);
          return;
        }
      }

      if (decision.phase === "done") {
        report(
          `Phần học đạt mục tiêu — GT ${formatTaskHours(gt)}, ÔL ${formatTaskHours(ol)} — về home.`
        );
        location.href = HOME_URL;
        scheduleNext(NAV_WAIT_MS);
        return;
      }
    }

    if (
      !isHomePage() &&
      !isPracticeSelectPage() &&
      !isQuizPage() &&
      !isStudyCurriculumPage() &&
      !isCourseSectionPage()
    ) {
      report("Không nhận diện trang — về home…");
      location.href = HOME_URL;
      scheduleNext(NAV_WAIT_MS);
      return;
    }

    report("Chờ trang…");
    scheduleNext(IDLE_POLL_MS);
  }

  async function tickPracticeOnly(settings) {
    if (state.phase === "done_practice") {
      await stop({ reason: "practice_complete" });
      return;
    }

    if (await tryHandlePracticeRoundComplete()) {
      scheduleNext(NAV_WAIT_MS);
      return;
    }

    if (
      state.phase === "practice_select" &&
      state.awaitingPracticeRestart &&
      !isPracticeSelectPage()
    ) {
      report("Chờ về màn chọn chủ đề…");
      scheduleNext(POLL_MS);
      return;
    }

    if (isPracticeSelectPage()) {
      if (state.phase === "init") state.phase = "practice_select";
      const acted = await handlePracticeSelectPageTick();
      scheduleNext(acted ? NAV_WAIT_MS : POLL_MS);
      return;
    }

    if (isQuizPage() && state.phase === "practice") {
      const loopStatus = window.NCN_CONTENT_API?.serverLoopStatus?.() || {
        running: false,
        count: 0,
      };
      state.serverLoopRunning = loopStatus.running === true;

      if (!state.serverLoopRunning) {
        report(
          `Bật auto server — lượt ${state.practiceRound + 1}/${state.maxPracticeRounds}…`
        );
        await ensureServerLoop(true);
        scheduleNext(POLL_MS);
        return;
      }

      report(
        `Đang làm bài (${loopStatus.count ?? 0} câu) — lượt ${state.practiceRound + 1}/${state.maxPracticeRounds}…`
      );
      scheduleNext(POLL_MS);
      return;
    }

    if (!isPracticeSelectPage() && !isQuizPage()) {
      report(
        "Cần ở trang chọn chủ đề ôn luyện (Tổng số câu hỏi) — mở đúng trang rồi chờ…"
      );
      scheduleNext(IDLE_POLL_MS);
      return;
    }

    scheduleNext(POLL_MS);
  }

  function scheduleNext(delayMs = POLL_MS) {
    if (!state.running || state.stopRequested) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      tick().catch((err) => {
        report(`Lỗi flow: ${err?.message || err}`, { error: true });
        scheduleNext(IDLE_POLL_MS);
      });
    }, delayMs);
  }

  async function start(options = {}) {
    if (state.running) {
      if (state.mode === "practice") {
        throw new Error("Đang chạy Auto server (3 lần) — dừng trước khi bật flow đầy đủ.");
      }
      return { ok: true, alreadyRunning: true };
    }

    const settings = await getFlowSettings();
    const userId = Number(options.userId ?? settings.ncnUserId) || 1;
    state.userId = userId;
    if (options.userId != null) {
      await new Promise((r) => chrome.storage.sync.set({ ncnUserId: userId }, r));
    }

    state.running = true;
    state.stopRequested = false;
    state.mode = "full";
    state.phase = "init";
    state.serverLoopRunning = false;
    state.scrollLoopRunning = false;
    state.practiceRound = 0;
    state.awaitingPracticeRestart = false;
    state.lastHandledServerLoopCount = 0;
    state.maxPracticeRounds =
      Number(settings.practiceRounds) || DEFAULT_PRACTICE_ROUNDS;

    await setStorageLocal({
      [STORAGE_KEY]: true,
      ncnFlowUserId: userId,
      ncnFlowMode: "full",
    });
    await chrome.runtime.sendMessage({ type: "FETCH_CHECK_STOP" }).catch(() => {});
    fetch("http://127.0.0.1:8765/reset-stop").catch(() => {});

    report(
      `Auto flow bắt đầu — user ${userId}, ngưỡng Số giờ ${settings.curriculumPercent || 40}% GT / ${settings.practicePercent || 60}% ÔL`
    );

    if (options.navigateLogin && !isTargetHost()) {
      location.href = LOGIN_URL;
    } else if (isLoginPage()) {
      /* tick will login */
    } else if (!isHomePage() && !isStudyCurriculumPage() && !isQuizPage()) {
      location.href = HOME_URL;
    }

    scheduleFocus();
    scheduleNext(800);
    return { ok: true, running: true };
  }

  async function startPracticeRounds(options = {}) {
    if (state.running) {
      if (state.mode === "practice") {
        return { ok: true, alreadyRunning: true, running: true, mode: "practice" };
      }
      throw new Error("Đang chạy flow đầy đủ — dừng trước khi bật Auto server (3 lần).");
    }

    const settings = await getFlowSettings();
    const userId = Number(options.userId ?? settings.ncnUserId) || 1;
    const maxRounds =
      Number(options.maxRounds ?? settings.practiceRounds) || DEFAULT_PRACTICE_ROUNDS;

    state.userId = userId;
    if (options.userId != null) {
      await new Promise((r) => chrome.storage.sync.set({ ncnUserId: userId }, r));
    }

    state.running = true;
    state.stopRequested = false;
    state.mode = "practice";
    state.phase = isPracticeSelectPage() ? "practice_select" : "init";
    state.serverLoopRunning = false;
    state.scrollLoopRunning = false;
    state.practiceRound = 0;
    state.awaitingPracticeRestart = false;
    state.lastHandledServerLoopCount = 0;
    state.maxPracticeRounds = maxRounds;

    const loopStatus = window.NCN_CONTENT_API?.serverLoopStatus?.() || {};
    state.serverLoopRunning = loopStatus.running === true;

    await setStorageLocal({
      [STORAGE_KEY]: true,
      ncnFlowUserId: userId,
      ncnFlowMode: "practice",
    });
    await chrome.runtime.sendMessage({ type: "FETCH_CHECK_STOP" }).catch(() => {});
    fetch("http://127.0.0.1:8765/reset-stop").catch(() => {});

    if (isPracticeSelectPage()) {
      report(`Auto server ${maxRounds} lượt — bắt đầu từ màn chọn chủ đề.`);
    } else if (isQuizPage()) {
      state.phase = "practice";
      report(`Auto server ${maxRounds} lượt — tiếp tục bài đang làm.`);
    } else {
      report(
        `Auto server ${maxRounds} lượt — mở trang chọn chủ đề (Tổng số câu hỏi)…`
      );
    }

    scheduleFocus();
    scheduleNext(800);
    return { ok: true, running: true, mode: "practice" };
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
    await stopLoops();
    await setStorageLocal({ [STORAGE_KEY]: false, ncnFlowMode: "idle" });
    const msg =
      options.reason === "hotkey"
        ? "Dừng bởi Ctrl+F8."
        : options.reason === "devtools_captcha"
          ? options.text ||
            `User ${state.userId}: popup nghi ngờ DevTools — dừng, cần giải captcha.`
          : options.reason === "practice_complete"
            ? `Đã xong ${state.maxPracticeRounds} lượt ôn luyện.`
          : options.reached
            ? "Đạt đủ giờ — dừng flow."
            : state.mode === "practice"
              ? "Đã dừng Auto server (3 lần)."
              : "Đã dừng auto flow.";
    report(msg);
    state.phase = "idle";
    state.mode = "idle";
    return { ok: true, running: false };
  }

  function status() {
    return {
      running: state.running,
      mode: state.mode,
      phase: state.phase,
      taskProgress: state.taskProgress || readCourseTaskHours(),
      lastReport: state.lastReport,
      hours: readStudyHours(),
      practiceRound: state.practiceRound,
      maxPracticeRounds: state.maxPracticeRounds,
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!state.running) return;
    if (message?.type === "DEVTOOLS_SUSPICION_DETECTED") {
      void handleDevtoolsSuspicion();
      return;
    }
    if (message?.type === "SERVER_LOOP_STOPPED" && message.naturalComplete) {
      void handleServerLoopNaturalComplete();
    }
  });

  async function init() {
    const data = await new Promise((r) =>
      chrome.storage.local.get(
        { [STORAGE_KEY]: false, ncnFlowUserId: null, ncnFlowMode: "full" },
        r
      )
    );
    if (data[STORAGE_KEY] && isTargetHost()) {
      if (data.ncnFlowMode === "practice") {
        startPracticeRounds({ userId: data.ncnFlowUserId ?? undefined });
      } else {
        start({ userId: data.ncnFlowUserId ?? undefined });
      }
    }
  }

  window.NCN_AUTO_FLOW = {
    start,
    startPracticeRounds,
    stop,
    status,
    handleServerLoopNaturalComplete,
    readStudyHours,
    readCourseTaskHours,
    decideCoursePhase,
    isLoginPage,
    isHomePage,
    isCourseSectionPage,
    isPracticeSelectPage,
  };

  init();
})();
