/**
 * Ôn luyện mô phỏng (dạng quiz): video + nhiều câu MCQ trong practice-group-question.
 *
 * QUAN TRỌNG — LMS khóa acc nếu click/scroll bằng DOM/script:
 * - Chỉ ĐỌC DOM (getBoundingClientRect, textContent, :checked…)
 * - Mọi click + scroll qua auto-py (pyautogui) — FETCH_AUTO_CLICK / FETCH_AUTO_SCROLL
 * - KHÔNG gọi .click(), scrollIntoView, scrollBy, WheelEvent, auto-answer DOM click
 */
(function () {
  const MODULE_KEY = "NCN_SIMULATION_QUIZ";
  const FEEDBACK_WAIT_MS = 6_000;
  const CORRECT_RESOLVE_MS = 8_000;
  const CHECK_RESULT_POLL_MS = 250;
  const CHECK_RESULT_MAX_MS = 25_000;
  const SELECTOR_ANSWER = ".mc-text-question__radio-answer";
  /** XPath đáp án đúng sau Kiểm tra (theo LMS). */
  const DEFAULT_MATCH_XPATH =
    ".//div[contains(@class,'mc-text-question__radio-answer') and contains(@class,'default-match')]//input[@type='radio']";
  /** Bước cuộn mỗi lần (pyautogui.scroll). */
  const SCROLL_STEP_MIN = 120;
  const SCROLL_STEP_RANGE = 80;
  /** Cuộn lên đầu tình huống mới — nhân 10 so với bước thường. */
  const SCROLL_TO_TOP_MULTIPLIER = 10;

  function normalizeText(t) {
    return String(t || "").replace(/\s+/g, " ").trim();
  }

  function clientToScreen(clientX, clientY) {
    const borderLeft = window.outerWidth - window.innerWidth;
    const borderTop = window.outerHeight - window.innerHeight;
    return {
      screenX: Math.round(window.screenX + borderLeft + clientX),
      screenY: Math.round(window.screenY + borderTop + clientY),
    };
  }

  function isRectInViewport(rect, margin = 72) {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    return (
      rect.top >= margin &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight - margin &&
      rect.right <= window.innerWidth
    );
  }

  /** Trang mô phỏng dạng quiz (video + MCQ), khác mô phỏng Space cũ. */
  function isSimulationQuizPage() {
    return Boolean(
      document.querySelector(".practice-group-question .question-content__video") &&
        document.querySelector(".practice-group-question .mc-text-question")
    );
  }

  function isOldSimulationPage() {
    return Boolean(document.querySelector("button.action-play"));
  }

  function pickBestGroupInViewport(candidates) {
    let best = null;
    let bestScore = Infinity;
    for (const g of candidates) {
      const r = g.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const style = getComputedStyle(g);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const offScreen =
        r.top < -r.height * 0.4 || r.bottom > window.innerHeight + r.height * 0.4;
      const score = Math.abs(r.top - 96) + (offScreen ? 5000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best || candidates[0] || null;
  }

  function getActiveGroup(options = {}) {
    const groups = [...document.querySelectorAll(".practice-group-question")];
    if (!groups.length) return null;

    const withVideo = groups.filter((g) =>
      g.querySelector(".question-content__video")
    );
    const pool = withVideo.length ? withVideo : groups;

    if (options.preferChecked || isCheckSubmitted()) {
      const checked = pool.filter((g) => {
        const panels = getSubQuestionPanels(g);
        return (
          panels.length > 0 &&
          panels.every(
            (p) => panelHasDefaultMatch(p) || p.querySelector(".correct-answer-box")
          )
        );
      });
      if (checked.length) {
        return pickBestGroupInViewport(checked);
      }
    }

    const fresh = pool.filter((g) => {
      const panels = getSubQuestionPanels(g);
      return panels.length > 0 && panels.every((p) => !hasPanelCheckResult(p));
    });
    const candidates = fresh.length ? fresh : pool;

    return pickBestGroupInViewport(candidates) || pool[0];
  }

  function getPanelWrapperId(panel) {
    if (!panel) return null;
    if (panel.id?.startsWith("question-wrapper-id-")) return panel.id;
    return panel.querySelector('[id^="question-wrapper-id-"]')?.id || panel.id || null;
  }

  function resolvePanelsByWrapperIds(ids) {
    const out = [];
    for (const id of ids || []) {
      if (!id) continue;
      const el = document.getElementById(id);
      if (el?.isConnected) out.push(el);
    }
    return out;
  }

  function isGroupChecked(group) {
    const panels = getSubQuestionPanels(group);
    if (!panels.length) return false;
    return panels.some((p) => hasPanelCheckResult(p)) && isCheckSubmitted();
  }

  function isGroupFresh(group) {
    const panels = getSubQuestionPanels(group);
    if (!panels.length) return false;
    return panels.every((p) => !hasPanelCheckResult(p));
  }

  function getScreenTitle() {
    return normalizeText(
      document.querySelector("#top_practicing_screen_title")?.textContent || ""
    );
  }

  function getStimulusText(group) {
    const root = group || getActiveGroup();
    if (!root) return "";
    const stimulus = root.querySelector(".practice-group-question__stimulus");
    if (!stimulus) return "";

    const isSubQuestionStem = (text) =>
      /là gì\?|phù hợp nhất|nhận biết (gián tiếp|trực tiếp)/i.test(text);

    const videoRoot =
      stimulus.querySelector(".question-content__video")?.closest(".question-content") ||
      stimulus.querySelector(".question-content");

    if (videoRoot) {
      for (const span of videoRoot.querySelectorAll("span.content-display")) {
        if (span.closest(".mc-text-question")) continue;
        const text = normalizeText(span.textContent);
        if (text.length > 2 && text.length <= 120 && !isSubQuestionStem(text)) {
          return text;
        }
      }
    }

    for (const span of stimulus.querySelectorAll("span.content-display")) {
      if (span.closest(".mc-text-question")) continue;
      const text = normalizeText(span.textContent);
      if (text.length > 2 && text.length <= 120 && !isSubQuestionStem(text)) {
        return text;
      }
    }

    const fallback = normalizeText(stimulus.textContent).slice(0, 120);
    return isSubQuestionStem(fallback) ? "" : fallback;
  }

  /**
   * Key tra/lưu BE: gắn tình huống (stimulus) + câu con để không trùng giữa các video.
   * VD: "Bò đứng giữa đường » Tình huống tiềm ẩn..."
   */
  const SIM_CTX_SEP = " » ";

  function buildSimQuizQuestionKey(stimulus, rawQuestion, panel) {
    const AA = window.NCN_AUTO_ANSWER;
    const base = AA?.buildQuestionForApi
      ? AA.buildQuestionForApi(rawQuestion, panel)
      : normalizeText(rawQuestion);
    const ctx = normalizeText(stimulus);
    if (!ctx) return base;
    return `${ctx}${SIM_CTX_SEP}${base}`;
  }

  function buildSimQuizApiFields(stimulus, panel) {
    const AA = window.NCN_AUTO_ANSWER;
    const rawQuestion = AA.getQuestionText(panel);
    let stimulusTitle = normalizeText(stimulus);
    if (!stimulusTitle) {
      stimulusTitle =
        normalizeText(getScreenTitle()) ||
        normalizeText(AA.getQuestionTitle(panel)) ||
        "on-luyen-mo-phong";
    }
    return { stimulusTitle, rawQuestion };
  }

  async function fetchSimQuizAnswer(stimulusTitle, rawQuestion, apiUrl) {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_SIM_QUIZ_ANSWER",
      stimulusTitle: stimulusTitle || "",
      question: rawQuestion,
      apiUrl,
    });
    if (!res?.ok) throw new Error(res?.error || "Gọi API mô phỏng quiz thất bại");
    return res.data;
  }

  async function insertSimQuizAnswer(payload, insertApiUrl) {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_SIM_QUIZ_INSERT",
      payload: {
        stimulusTitle: payload.stimulusTitle,
        question: payload.rawQuestion || payload.question,
        correctAnswerIndex: Math.max(0, Math.floor(Number(payload.correctAnswerIndex))),
      },
      insertApiUrl,
    });
    if (!res?.ok) throw new Error(res?.error || "Gọi API insert mô phỏng quiz thất bại");
    return res.data;
  }

  async function postSimQuizDebug(payload, debugApiUrl) {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_SIM_QUIZ_DEBUG",
      payload,
      debugApiUrl,
    });
    if (!res?.ok) throw new Error(res?.error || "Gọi API debug mô phỏng quiz thất bại");
    return res.data;
  }

  async function insertSimQuizBatch(items, batchApiUrl) {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_SIM_QUIZ_INSERT_BATCH",
      items,
      batchApiUrl,
    });
    if (!res?.ok) throw new Error(res?.error || "Gọi API insert-batch mô phỏng quiz thất bại");
    return res.data;
  }

  function getSimAnswerDelayMs(settings) {
    const min =
      settings.simAnswerDelayMinMs ??
      Math.min(settings.answerDelayMinMs ?? 350, 900);
    const max =
      settings.simAnswerDelayMaxMs ??
      Math.min(settings.answerDelayMaxMs ?? 900, 1200);
    const lo = Math.max(0, Math.min(min, max));
    const hi = Math.max(lo, max);
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /** Chờ sau click video — mặc định ~20s (giả lập xem video). */
  function getSimVideoWatchDelayMs(settings) {
    const min = settings.simVideoWatchMinMs ?? 18_000;
    const max = settings.simVideoWatchMaxMs ?? 22_000;
    const lo = Math.max(0, Math.min(min, max));
    const hi = Math.max(lo, max);
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /** Thu thập kết quả 4 câu sau Kiểm tra (HTML chỉ khi bật debug). */
  function collectCheckResultsPayload(group, stimulus, resultPanels, options = {}) {
    const includeHtml = options.includeHtml === true;
    const AA = window.NCN_AUTO_ANSWER;
    const syncGroup = getActiveGroup({ preferChecked: true }) || group;
    const syncStimulus = getStimulusText(syncGroup) || stimulus;
    const root = syncGroup || group;
    const panels = [];

    for (let i = 0; i < resultPanels.length; i++) {
      const panel = resolveLivePanel(resultPanels[i]) || resultPanels[i];
      const { stimulusTitle, rawQuestion } = buildSimQuizApiFields(syncStimulus, panel);
      const resolved = readPanelCorrectAnswer(panel);
      const selectedIndex = getSelectedAnswerIndex(panel);
      const answers = AA?.getAnswerOptions?.(panel) || getAnswerBoxes(panel);
      const answerTexts = answers.map((a) =>
        AA?.getAnswerOptionText ? AA.getAnswerOptionText(a) : getAnswerOptionText(a)
      );

      panels.push({
        panelIndex: i,
        wrapperId: getPanelWrapperId(panel),
        stimulusTitle,
        question: rawQuestion,
        selectedIndex,
        correctIndex: resolved.index,
        correctText: resolved.correctText,
        source: resolved.source,
        hasDefaultMatch: panelHasDefaultMatch(panel),
        answerTexts,
        ...(includeHtml
          ? { panelHtml: panel?.outerHTML?.slice(0, 120_000) || "" }
          : {}),
      });
    }

    const defaultMatchCount = panels.filter(
      (p) => p.correctIndex !== null && p.correctIndex !== undefined
    ).length;

    const collected = collectDefaultMatchesFromGroup(syncGroup);
    for (const item of collected) {
      const p = panels[item.panelIndex];
      if (!p) continue;
      if (p.correctIndex === null || p.correctIndex === undefined) {
        p.correctIndex = item.index;
        p.correctText = item.correctText;
        p.source = item.source;
        p.hasDefaultMatch = true;
      }
    }

    const finalDefaultMatchCount = panels.filter(
      (p) => p.correctIndex !== null && p.correctIndex !== undefined
    ).length;

    return {
      stimulusTitle: syncStimulus,
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      checkSubmitted: isCheckSubmitted(),
      defaultMatchCount: finalDefaultMatchCount,
      panelCount: panels.length,
      groupText: normalizeText(root?.textContent || "").slice(0, 8000),
      ...(includeHtml
        ? {
            groupHtml: root?.outerHTML?.slice(0, 400_000) || "",
            documentHtml: document.documentElement?.outerHTML?.slice(0, 600_000) || "",
          }
        : {}),
      panels,
    };
  }

  /** Insert từ payload đã thu thập — không đọc lại DOM. */
  async function insertFromCheckPayload(payload, insertApiUrl, batchApiUrl, onProgress) {
    const toInsert = (payload.panels || []).filter(
      (p) => p.correctIndex !== null && p.correctIndex !== undefined && p.question
    );

    const summary = [];
    let syncedCount = 0;

    if (!toInsert.length) {
      for (const p of payload.panels || []) {
        summary.push({
          index: p.panelIndex,
          synced: false,
          reason: "no_correct_index",
          question: String(p.question || "").slice(0, 60),
        });
      }
      return { syncedCount: 0, summary, panelCount: payload.panels?.length || 0 };
    }

    onProgress?.(`Insert batch ${toInsert.length} câu…`);

    let batchResult = null;
    try {
      batchResult = await insertSimQuizBatch(
        toInsert.map((p) => ({
          stimulusTitle: p.stimulusTitle || payload.stimulusTitle,
          question: p.question,
          correctAnswerIndex: p.correctIndex,
        })),
        batchApiUrl
      );
    } catch (err) {
      onProgress?.(`Batch insert lỗi — thử từng câu: ${err?.message || err}`);
    }

    if (batchResult?.success && Array.isArray(batchResult.results)) {
      for (let i = 0; i < toInsert.length; i++) {
        const p = toInsert[i];
        const r = batchResult.results[i];
        if (r?.ok) {
          syncedCount += 1;
          summary.push({
            index: p.panelIndex,
            synced: true,
            correctIndex: p.correctIndex,
            answerText: p.correctText,
            source: p.source,
          });
          onProgress?.(
            `Câu ${p.panelIndex + 1}: INSERT OK [${p.correctIndex}] "${(p.correctText || "").slice(0, 36)}"`
          );
        } else {
          summary.push({
            index: p.panelIndex,
            synced: false,
            reason: "insert_error",
            error: r?.error || "batch failed",
          });
          onProgress?.(`Câu ${p.panelIndex + 1}: batch fail — ${r?.error || "?"}`);
        }
      }
    } else {
      for (const p of toInsert) {
        onProgress?.(
          `Câu ${p.panelIndex + 1}: INSERT [${p.correctIndex}] "${(p.correctText || "").slice(0, 36)}"`
        );
        try {
          await insertSimQuizAnswer(
            {
              stimulusTitle: p.stimulusTitle || payload.stimulusTitle,
              rawQuestion: p.question,
              correctAnswerIndex: p.correctIndex,
            },
            insertApiUrl
          );
          syncedCount += 1;
          summary.push({
            index: p.panelIndex,
            synced: true,
            correctIndex: p.correctIndex,
            answerText: p.correctText,
            source: p.source,
          });
        } catch (err) {
          summary.push({
            index: p.panelIndex,
            synced: false,
            reason: "insert_error",
            error: String(err?.message || err),
          });
          onProgress?.(`Câu ${p.panelIndex + 1}: LỖI INSERT — ${err?.message || err}`);
        }
      }
    }

    for (const p of payload.panels || []) {
      if (p.correctIndex === null || p.correctIndex === undefined) {
        summary.push({
          index: p.panelIndex,
          synced: false,
          reason: "no_correct_index",
          question: String(p.question || "").slice(0, 60),
        });
      }
    }

    return { syncedCount, summary, panelCount: payload.panels?.length || 0 };
  }

  /** Các panel con có đáp án radio (bỏ panel video/stimulus). */
  function getSubQuestionPanels(group) {
    const root = group || getActiveGroup();
    if (!root) return [];
    return [...root.querySelectorAll(".question-panel")].filter((panel) =>
      panel.querySelector(".mc-text-question")
    );
  }

  /** Poll sau Tiếp — đọc group MỚI từ DOM, không dùng reference cũ. */
  async function waitForSituationChange(beforeKey, beforeStimulus, onProgress, timeoutMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const active = getActiveGroup();
      const key = getSituationKey(active);
      const stimulus = getStimulusText(active);

      if (key && beforeKey && key !== beforeKey) {
        onProgress?.(`Tình huống mới: ${stimulus || key.slice(0, 40)}`);
        return { group: active, key, stimulus };
      }

      if (
        stimulus &&
        beforeStimulus &&
        stimulus.toLowerCase() !== beforeStimulus.toLowerCase()
      ) {
        onProgress?.(`Tình huống mới: ${stimulus}`);
        return { group: active, key, stimulus };
      }

      if (
        isGroupFresh(active) &&
        findPracticeNavButton("Kiểm tra", { requireEnabled: true })
      ) {
        onProgress?.(`Tình huống mới (chưa Kiểm tra): ${stimulus || "?"}`);
        return { group: active, key, stimulus };
      }

      await sleep(200);
    }
    return null;
  }

  function getSituationKey(group) {
    const stimulus = getStimulusText(group);
    const panels = getSubQuestionPanels(group);
    const firstQ = panels[0]
      ? normalizeText(
          panels[0].querySelector(".question-content .content-display")?.textContent ||
            ""
        )
      : "";
    return `${stimulus}||${firstQ}`.toLowerCase();
  }

  function getVideoElement(group) {
    const root = group || getActiveGroup();
    return (
      root?.querySelector(".question-content__video video") ||
      root?.querySelector(".question-content__video") ||
      null
    );
  }

  function getVideoClickCoords(group) {
    const video = getVideoElement(group);
    if (!video) return null;

    const rect = video.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return null;

    const clientX = Math.round(rect.left + rect.width * (0.35 + Math.random() * 0.3));
    const clientY = Math.round(rect.top + rect.height * (0.35 + Math.random() * 0.3));
    return clientToScreen(clientX, clientY);
  }

  function getAnswerBoxes(panel) {
    return [...(panel || document).querySelectorAll(SELECTOR_ANSWER)];
  }

  function getAnswerOptionText(box) {
    const AA = window.NCN_AUTO_ANSWER;
    if (AA?.getAnswerOptionText) return AA.getAnswerOptionText(box);
    const display = box.querySelector(".content-display");
    return normalizeText(display?.textContent || box.textContent);
  }

  /**
   * Đáp án đúng sau Kiểm tra — ưu tiên default-match (+ radio bên trong).
   * Tương đương XPath:
   * //div[contains(@class,'mc-text-question__radio-answer') and contains(@class,'default-match')]//input[@type='radio']
   */
  function findDefaultMatchAnswerIndex(panel) {
    const live = resolveLivePanel(panel) || panel;
    if (!live) return { index: null, box: null, source: null, correctText: null };

    const answers = getAnswerBoxes(live);

    for (let i = 0; i < answers.length; i++) {
      const box = answers[i];
      if (
        hasCssClass(box, "default-match") &&
        box.querySelector('input[type="radio"]')
      ) {
        return {
          index: i,
          box,
          source: "default-match",
          correctText: getAnswerOptionText(box),
        };
      }
    }

    const byQuery = live.querySelector(
      `${SELECTOR_ANSWER}.default-match input[type="radio"]`
    );
    if (byQuery) {
      const matchBox =
        byQuery.closest(SELECTOR_ANSWER) ||
        byQuery.parentElement?.closest?.(SELECTOR_ANSWER);
      if (matchBox) {
        const idx = answers.indexOf(matchBox);
        if (idx >= 0) {
          return {
            index: idx,
            box: matchBox,
            source: "default-match-query",
            correctText: getAnswerOptionText(matchBox),
          };
        }
      }
    }

    try {
      const radio = document.evaluate(
        DEFAULT_MATCH_XPATH,
        live,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (radio) {
        const matchBox =
          radio.closest(SELECTOR_ANSWER) ||
          radio.parentElement?.closest?.(SELECTOR_ANSWER);
        if (matchBox) {
          const idx = answers.indexOf(matchBox);
          if (idx >= 0) {
            return {
              index: idx,
              box: matchBox,
              source: "default-match-xpath",
              correctText: getAnswerOptionText(matchBox),
            };
          }
        }
      }
    } catch {
      /* ignore */
    }

    return { index: null, box: null, source: null, correctText: null };
  }

  function hasCssClass(el, className) {
    if (!el) return false;
    if (el.classList?.contains(className)) return true;
    return ` ${el.className || ""} `.includes(` ${className} `);
  }

  function countUnansweredPanels(panels) {
    return panels.filter((p) => getSelectedAnswerIndex(p) === null).length;
  }

  /** Quét cả nhóm — mọi .default-match trong practice-group-question. */
  function collectDefaultMatchesFromGroup(group) {
    const root = getActiveGroup({ preferChecked: true }) || group;
    if (!root) return [];

    const panels = getSubQuestionPanels(root).map((p) => resolveLivePanel(p) || p);
    const byPanel = new Map();

    for (const panel of panels) {
      const m = findDefaultMatchAnswerIndex(panel);
      if (m.index !== null && m.index !== undefined) {
        byPanel.set(panel, m);
      }
    }

    if (byPanel.size < panels.length) {
      const matches = root.querySelectorAll(`${SELECTOR_ANSWER}.default-match`);
      for (const matchBox of matches) {
        const panel = matchBox.closest(".question-panel");
        if (!panel || byPanel.has(panel)) continue;
        const answers = getAnswerBoxes(panel);
        const idx = answers.indexOf(matchBox);
        if (idx < 0) {
          const idx2 = answers.findIndex((b) => hasCssClass(b, "default-match"));
          if (idx2 >= 0) {
            byPanel.set(panel, {
              index: idx2,
              correctText: getAnswerOptionText(answers[idx2]),
              source: "group-scan",
            });
          }
        } else {
          byPanel.set(panel, {
            index: idx,
            correctText: getAnswerOptionText(matchBox),
            source: "group-scan",
          });
        }
      }
    }

    return panels
      .map((panel, panelIndex) => {
        const m = byPanel.get(panel);
        if (!m) return null;
        return {
          panelIndex,
          panel,
          index: m.index,
          correctText: m.correctText,
          source: m.source,
        };
      })
      .filter(Boolean);
  }

  /** Click Kiểm tra + xác nhận nút disabled (đã submit). */
  async function clickKiemTraWithVerify(
    clickApiUrl,
    serverScrollIntoView,
    onProgress,
    shouldStop
  ) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (shouldStop?.()) throw new Error("STOP_REQUESTED");

      if (isCheckSubmitted()) {
        onProgress?.("Kiểm tra đã submit (nút disabled).");
        return true;
      }

      let kiemTraBtn = findEnabledKiemTraButton();
      if (!kiemTraBtn) {
        onProgress?.(`Chờ nút Kiểm tra… (${attempt}/4)`);
        await sleep(600);
        kiemTraBtn = findEnabledKiemTraButton();
      }
      if (!kiemTraBtn) {
        if (isCheckSubmitted()) return true;
        throw new Error("Không tìm thấy nút Kiểm tra (enabled).");
      }

      await clickElementViaPython(
        kiemTraBtn,
        clickApiUrl,
        null,
        onProgress,
        `Click Kiểm tra (${attempt}/4)`,
        (btn) => getButtonScreenCoords(btn, false)
      );

      for (let w = 0; w < 24; w++) {
        if (isCheckSubmitted()) {
          onProgress?.(`Kiểm tra OK sau ${attempt} lần click.`);
          return true;
        }
        await sleep(250);
      }

      onProgress?.(`Kiểm tra chưa ăn (nút vẫn enabled) — thử lại…`);
      await sleep(500);
    }

    throw new Error("Click Kiểm tra không submit sau 4 lần — kiểm tra tọa độ click Python.");
  }

  function panelHasDefaultMatch(panel) {
    const m = findDefaultMatchAnswerIndex(panel);
    return m.index !== null && m.index !== undefined;
  }

  /** Chỉ đọc DOM — kiểm tra radio đã chọn. */
  function getSelectedAnswerIndex(panel) {
    const boxes = getAnswerBoxes(panel);
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].querySelector('input[type="radio"]')?.checked) return i;
    }
    return null;
  }

  /** Tọa độ màn hình từ getBoundingClientRect — không scroll/click DOM. */
  function getAnswerBoxScreenCoords(box, randomize = true) {
    const rect = box.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      throw new Error("Đáp án không hiển thị trên màn hình.");
    }
    const padX = Math.max(6, rect.width * 0.12);
    const padY = Math.max(6, rect.height * 0.2);
    const clientX = randomize
      ? Math.round(rect.left + padX + Math.random() * Math.max(1, rect.width - 2 * padX))
      : Math.round(rect.left + rect.width / 2);
    const clientY = randomize
      ? Math.round(rect.top + padY + Math.random() * Math.max(1, rect.height - 2 * padY))
      : Math.round(rect.top + rect.height / 2);
    return clientToScreen(clientX, clientY);
  }

  function findButtonByText(text, { exact = true, requireEnabled = false, root = document } = {}) {
    const want = normalizeText(text).toLowerCase();
    for (const btn of root.querySelectorAll("button")) {
      const label = normalizeText(btn.textContent).toLowerCase();
      const match = exact ? label === want : label.includes(want);
      if (!match) continue;
      if (requireEnabled && btn.disabled) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const style = getComputedStyle(btn);
      if (style.display === "none" || style.visibility === "hidden") continue;
      return btn;
    }
    return null;
  }

  /** Nút Trước / Kiểm tra / Tiếp ở footer bài luyện — tránh bắt nhầm nút khác. */
  function findPracticeNavButton(text, { requireEnabled = false } = {}) {
    const anchors = [
      findButtonByText("Kiểm tra"),
      findButtonByText("Tiếp"),
      findButtonByText("Trước"),
      document.querySelector(".normal-exercise-control-question-group"),
      document.querySelector(".practice-group-question"),
      document.querySelector("#learn-item-content"),
    ].filter(Boolean);

    for (const anchor of anchors) {
      const root =
        anchor.closest?.(".normal-exercise-control-question-group") ||
        anchor.closest?.(".row") ||
        anchor.parentElement ||
        anchor;
      const btn = findButtonByText(text, { requireEnabled, root });
      if (btn) return btn;
    }

    return findButtonByText(text, { requireEnabled });
  }

  function findEnabledTiepButton() {
    return findPracticeNavButton("Tiếp", { requireEnabled: true });
  }

  function findEnabledKiemTraButton() {
    return findPracticeNavButton("Kiểm tra", { requireEnabled: true });
  }

  function getButtonScreenCoords(button, randomize = true) {
    const rect = button.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      throw new Error("Nút không hiển thị.");
    }
    const padX = Math.max(4, rect.width * 0.15);
    const padY = Math.max(4, rect.height * 0.15);
    const clientX = randomize
      ? Math.round(rect.left + padX + Math.random() * Math.max(1, rect.width - 2 * padX))
      : Math.round(rect.left + rect.width / 2);
    const clientY = randomize
      ? Math.round(rect.top + padY + Math.random() * Math.max(1, rect.height - 2 * padY))
      : Math.round(rect.top + rect.height / 2);
    return clientToScreen(clientX, clientY);
  }

  function getScrollAnchorScreenCoords() {
    const root =
      document.querySelector("#learn-item-content") ||
      document.querySelector(".practice-group-question") ||
      document.body;
    const rect = root.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.min(rect.width * 0.55, rect.width - 20));
    const clientY = Math.round(rect.top + Math.min(rect.height * 0.45, rect.height - 20));
    return clientToScreen(
      Math.max(8, clientX),
      Math.max(80, Math.min(clientY, window.innerHeight - 80))
    );
  }

  function getScrollDeltaForRect(rect, margin = 72) {
    if (!rect || rect.height < 1) return 0;
    const step = SCROLL_STEP_MIN + Math.floor(Math.random() * SCROLL_STEP_RANGE);
    if (rect.bottom > window.innerHeight - margin) {
      return -step;
    }
    if (rect.top < margin) {
      return step;
    }
    return 0;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Click qua auto-py — tuyệt đối không thao tác DOM. */
  async function invokePythonClick(screenCoords, clickApiUrl) {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_AUTO_CLICK",
      x: screenCoords.screenX,
      y: screenCoords.screenY,
      clickApiUrl,
    });
    if (!res?.ok) throw new Error(res?.error || "Python click thất bại");
    return res.data;
  }

  /** @deprecated alias */
  async function invokeServerClick(coords, clickApiUrl) {
    return invokePythonClick(coords, clickApiUrl);
  }

  /**
   * Scroll (Python UI) rồi click đáp án — ack bằng đọc :checked, không dispatch event.
   */
  async function clickAnswerViaPython(
    panel,
    index0,
    clickApiUrl,
    serverScrollIntoView,
    onProgress
  ) {
    const boxes = getAnswerBoxes(panel);
    if (index0 < 0 || index0 >= boxes.length) {
      throw new Error(`Index đáp án ${index0} không hợp lệ (${boxes.length} lựa chọn).`);
    }
    const box = boxes[index0];

    for (let attempt = 1; attempt <= 4; attempt++) {
      if (serverScrollIntoView) {
        await serverScrollIntoView(box, onProgress);
      }
      onProgress?.(`Python click đáp án [${index0}] (${attempt}/4)…`);
      await invokePythonClick(getAnswerBoxScreenCoords(box, attempt < 3), clickApiUrl);
      await sleep(180 + Math.random() * 120);
      if (getSelectedAnswerIndex(panel) === index0) return;
    }

    throw new Error(
      `Python click đáp án [${index0}] không ăn — thử scroll tay rồi chạy lại.`
    );
  }

  /** Scroll (Python UI) rồi click phần tử (nút, video…). */
  async function clickElementViaPython(
    element,
    clickApiUrl,
    serverScrollIntoView,
    onProgress,
    label,
    coordFn = getButtonScreenCoords
  ) {
    if (!element) throw new Error(`Không có phần tử để ${label}`);
    if (serverScrollIntoView) {
      await serverScrollIntoView(element, onProgress);
    }
    onProgress?.(`${label} (Python UI)…`);
    const coords =
      typeof coordFn === "function" && coordFn.length === 0
        ? coordFn()
        : coordFn(element);
    await invokePythonClick(coords, clickApiUrl);
  }

  /** Sau Kiểm tra React có thể thay DOM — lấy lại panel đang gắn document. */
  function resolveLivePanel(panel) {
    if (!panel) return null;
    if (panel.isConnected) return panel;

    const wrapperId =
      panel.id ||
      panel.querySelector('[id^="question-wrapper-id-"]')?.id ||
      panel.closest('[id^="question-wrapper-id-"]')?.id;
    if (wrapperId) {
      const live = document.getElementById(wrapperId);
      if (live?.isConnected) return live;
    }

    const headerId = panel.querySelector('[id^="question-header-"]')?.id;
    if (headerId) {
      const live = document.getElementById(headerId)?.closest(".question-panel");
      if (live?.isConnected) return live;
    }

    const innerId = panel.querySelector('[id^="question"]')?.id;
    if (innerId) {
      const live = document.getElementById(innerId)?.closest(".question-panel");
      if (live?.isConnected) return live;
    }

    return null;
  }

  function getLiveSubQuestionPanels(fallbackGroup) {
    const group = getActiveGroup() || fallbackGroup;
    return getSubQuestionPanels(group);
  }

  function isPanelAnswerReadable(panel) {
    const live = resolveLivePanel(panel) || panel;
    const resolved = readPanelCorrectAnswer(live);
    return resolved.index !== null && resolved.index !== undefined;
  }

  /** Chỉ coi là xong khi đã có default-match hoặc correct-answer-box. */
  function hasPanelCheckResult(panel) {
    const live = resolveLivePanel(panel) || panel;
    if (!live?.isConnected) return false;

    if (panelHasDefaultMatch(live)) return true;
    if (live.querySelector(".correct-answer-box")) return true;

    return false;
  }

  function isCheckSubmitted() {
    const btn = findPracticeNavButton("Kiểm tra");
    return Boolean(btn?.disabled);
  }

  /** Đọc đáp án đúng TRỰC TIẾP từ panel — không qua findAnsweredQuestionPanel (sai khi 4 câu). */
  function readCorrectAnswerTextFromPanel(panel) {
    const live = resolveLivePanel(panel) || panel;
    if (!live) return "";
    const box = live.querySelector(".correct-answer-box");
    if (!box) return "";

    const text = (box.textContent || "").replace(/\s+/g, " ").trim();
    const match = text.match(/câu\s+trả\s+lời\s+chính\s+xác\s+là:?\s*(.+)$/i);
    if (match?.[1]) return match[1].trim();

    for (const node of box.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const chunk = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (chunk.length > 1) return chunk;
      }
    }

    const labelEl = [...box.querySelectorAll(".text-bold, span, div")].find((el) =>
      /câu\s+trả\s+lời\s+chính\s+xác/i.test(el.textContent || "")
    );
    if (labelEl) {
      const sibling = (labelEl.nextSibling?.textContent || "").trim();
      if (sibling) return sibling;
      const parentText = (labelEl.parentElement?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const inline = parentText.match(/câu\s+trả\s+lời\s+chính\s+xác\s+là:?\s*(.+)$/i);
      if (inline?.[1]) return inline[1].trim();
    }

    return text
      .replace(/chưa\s+chính\s+xác/gi, "")
      .replace(/chính\s+xác/gi, "")
      .replace(/câu\s+trả\s+lời\s+chính\s+xác\s+là:?/gi, "")
      .trim();
  }

  function readPanelCorrectAnswer(panel) {
    const AA = window.NCN_AUTO_ANSWER;
    const live = resolveLivePanel(panel) || panel;
    if (!live) return { index: null, source: null, correctText: null };

    const matched = findDefaultMatchAnswerIndex(live);
    if (matched.index !== null && matched.index !== undefined) {
      return {
        index: matched.index,
        source: matched.source,
        correctText: matched.correctText,
      };
    }

    const boxes = getAnswerBoxes(live);
    const correctText = readCorrectAnswerTextFromPanel(live);
    if (correctText && AA) {
      const idx = AA.findAnswerPositionByLabel(live, correctText);
      if (idx !== null && idx !== undefined) {
        return { index: idx, source: "correct-box", correctText };
      }
      for (let i = 0; i < boxes.length; i++) {
        const opt = normalizeText(AA.getAnswerOptionText(boxes[i])).toLowerCase();
        const want = normalizeText(correctText).toLowerCase();
        if (opt && want && (opt === want || opt.includes(want) || want.includes(opt))) {
          return { index: i, source: "correct-box-fuzzy", correctText };
        }
      }
    } else if (correctText) {
      for (let i = 0; i < boxes.length; i++) {
        const opt = getAnswerOptionText(boxes[i]).toLowerCase();
        const want = normalizeText(correctText).toLowerCase();
        if (opt && want && (opt === want || opt.includes(want) || want.includes(opt))) {
          return { index: i, source: "correct-box-fuzzy", correctText };
        }
      }
    }

    return { index: null, source: null, correctText: correctText || null };
  }

  async function waitForPanelCorrectAnswer(panel, onProgress, maxWaitMs = CORRECT_RESOLVE_MS) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const live = resolveLivePanel(panel) || panel;
      const resolved = readPanelCorrectAnswer(live);
      if (resolved.index !== null && resolved.index !== undefined) {
        return resolved;
      }
      onProgress?.("Chờ đáp án đúng (default-match / correct-answer-box)…");
      await sleep(250);
    }
    const live = resolveLivePanel(panel) || panel;
    return readPanelCorrectAnswer(live);
  }

  /** Poll DOM sau Kiểm tra — quét cả nhóm, không cần scroll từng panel. */
  async function waitForCheckResults(group, onProgress, panelWrapperIds = []) {
    const start = Date.now();
    while (Date.now() - start < CHECK_RESULT_MAX_MS) {
      const anchored = resolvePanelsByWrapperIds(panelWrapperIds);
      const activeGroup = getActiveGroup({ preferChecked: true }) || group;
      const panels =
        anchored.length > 0 ? anchored : getSubQuestionPanels(activeGroup);

      if (!panels.length) {
        await sleep(CHECK_RESULT_POLL_MS);
        continue;
      }

      const collected = collectDefaultMatchesFromGroup(activeGroup);
      const readable = collected.length > 0
        ? collected.length
        : panels.filter((p) => isPanelAnswerReadable(p)).length;

      if (readable === panels.length) {
        onProgress?.(`Đã đọc được đáp án ${readable}/${panels.length} câu (default-match).`);
        return panels.map((p) => resolveLivePanel(p) || p);
      }

      if (readable > 0) {
        onProgress?.(`Kết quả ${readable}/${panels.length} câu — chờ default-match…`);
      } else {
        onProgress?.("Chờ kết quả sau Kiểm tra (default-match)…");
      }

      await sleep(CHECK_RESULT_POLL_MS);
    }

    const fallback =
      resolvePanelsByWrapperIds(panelWrapperIds).length > 0
        ? resolvePanelsByWrapperIds(panelWrapperIds)
        : getSubQuestionPanels(getActiveGroup({ preferChecked: true }) || group);

    const readable = fallback.filter((p) => isPanelAnswerReadable(p)).length;
    onProgress?.(
      `Hết thời gian chờ — ${readable}/${fallback.length} câu đọc được, vẫn thử sync…`
    );
    return fallback.map((p) => resolveLivePanel(p) || p);
  }


  function isPanelUserWrong(panel) {
    if (
      panel.classList.contains("question-panel--incorrect") ||
      panel.outerHTML.includes("question-panel--incorrect")
    ) {
      return true;
    }
    const AA = window.NCN_AUTO_ANSWER;
    if (AA?.isPanelIncorrect?.(panel)) return true;
    return false;
  }

  /**
   * Đọc kết quả tất cả câu con → upsert BE (đáp án đúng từ default-match / correct-answer-box).
   */
  async function syncAllPanelResultsToDb(
    panels,
    stimulus,
    apiUrl,
    insertApiUrl,
    onProgress,
    group = null
  ) {
    const AA = window.NCN_AUTO_ANSWER;
    if (!AA) throw new Error("Module trả lời chưa sẵn sàng");

    const collected = collectDefaultMatchesFromGroup(group);
    const summary = [];
    let syncedCount = 0;

    const workItems =
      collected.length > 0
        ? collected
        : panels.map((panel, panelIndex) => ({ panelIndex, panel }));

    onProgress?.(
      collected.length > 0
        ? `Quét nhóm: ${collected.length} default-match`
        : `Sync ${panels.length} panel (chưa thấy default-match nhóm)`
    );

    for (const item of workItems) {
      const i = item.panelIndex;
      const panel = resolveLivePanel(item.panel) || item.panel;
      if (!panel?.isConnected) {
        onProgress?.(`Câu ${i + 1}: panel không còn trên DOM — bỏ qua`);
        summary.push({ index: i, synced: false, reason: "panel_detached" });
        continue;
      }

      const { stimulusTitle, rawQuestion } = buildSimQuizApiFields(stimulus, panel);

      let resolved;
      if (item.index !== null && item.index !== undefined) {
        resolved = {
          index: item.index,
          correctText: item.correctText,
          source: item.source || "group-collect",
        };
      } else {
        resolved = await waitForPanelCorrectAnswer(panel, (t) =>
          onProgress?.(`Câu ${i + 1}: ${t}`)
        );
      }

      if (resolved.index === null || resolved.index === undefined) {
        summary.push({
          index: i,
          synced: false,
          reason: "no_correct_index",
          question: rawQuestion.slice(0, 60),
          stimulus,
        });
        onProgress?.(
          `Câu ${i + 1}: KHÔNG đọc được default-match — "${(resolved.correctText || rawQuestion).slice(0, 40)}"`
        );
        continue;
      }

      const answers = AA.getAnswerOptions(panel);
      const answerText = AA.getAnswerOptionText(answers[resolved.index]);
      const userWrong = isPanelUserWrong(panel);

      let apiIdx = null;
      try {
        const api = await fetchSimQuizAnswer(stimulusTitle, rawQuestion, apiUrl);
        if (api?.success && api.found && api.data) {
          apiIdx = AA.resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
        }
      } catch {
        /* ignore */
      }

      const alreadyInDb = Number.isInteger(apiIdx) && apiIdx === resolved.index;
      if (alreadyInDb) {
        summary.push({
          index: i,
          synced: false,
          alreadySynced: true,
          correctIndex: resolved.index,
          userWrong,
          answerText,
          source: resolved.source,
        });
        onProgress?.(
          `Câu ${i + 1}: DB đã có [${resolved.index}] (${stimulusTitle})`
        );
        continue;
      }

      onProgress?.(
        `Câu ${i + 1}: INSERT [${resolved.index}] "${(answerText || "").slice(0, 36)}" (${resolved.source})`
      );

      try {
        await insertSimQuizAnswer(
          {
            stimulusTitle,
            rawQuestion,
            correctAnswerIndex: resolved.index,
          },
          insertApiUrl
        );
      } catch (err) {
        onProgress?.(`Câu ${i + 1}: LỖI INSERT — ${err?.message || err}`);
        summary.push({
          index: i,
          synced: false,
          reason: "insert_error",
          error: String(err?.message || err),
          stimulus: stimulusTitle,
        });
        continue;
      }

      syncedCount += 1;
      summary.push({
        index: i,
        synced: true,
        correctIndex: resolved.index,
        userWrong,
        answerText,
        source: resolved.source,
      });
    }

    return { syncedCount, summary, panelCount: workItems.length };
  }

  /** Bấm Tiếp — click giữa nút (không scroll), retry nếu trượt. */
  async function clickTiepAfterCheck(
    clickApiUrl,
    serverScrollIntoView,
    onProgress,
    shouldStop
  ) {
    const beforeKey = getSituationKey(getActiveGroup());
    const beforeStimulus = getStimulusText(getActiveGroup());

    for (let w = 0; w < 30; w++) {
      if (shouldStop?.()) throw new Error("STOP_REQUESTED");
      if (findEnabledTiepButton()) break;
      await sleep(200);
    }

    for (let attempt = 1; attempt <= 4; attempt++) {
      if (shouldStop?.()) throw new Error("STOP_REQUESTED");

      const tiepBtn = findEnabledTiepButton();
      if (!tiepBtn) {
        onProgress?.(`Chờ nút Tiếp… (${attempt}/4)`);
        await sleep(500);
        continue;
      }

      const rect = tiepBtn.getBoundingClientRect();
      onProgress?.(
        `Click Tiếp (${attempt}/4) tại (${Math.round(rect.left + rect.width / 2)}, ${Math.round(rect.top + rect.height / 2)})…`
      );

      await clickElementViaPython(
        tiepBtn,
        clickApiUrl,
        null,
        onProgress,
        attempt > 1 ? `Click Tiếp lần ${attempt}` : "Click Tiếp",
        (btn) => getButtonScreenCoords(btn, false)
      );
      await sleep(900 + Math.random() * 400);

      const changed = await waitForSituationChange(
        beforeKey,
        beforeStimulus,
        onProgress,
        attempt >= 4 ? 12_000 : 5_000
      );
      if (changed) {
        return {
          ok: true,
          nextAttempts: attempt,
          beforeKey,
          afterKey: changed.key,
          stimulus: changed.stimulus,
          group: changed.group,
        };
      }

      onProgress?.(`Tiếp chưa đổi tình huống — thử lại (${attempt}/4)…`);
      await sleep(400);
    }

    throw new Error("Click Tiếp không đổi tình huống sau 4 lần.");
  }

  /**
   * Sau Tiếp trang thường ở cuối — cuộn lên (Python) để video/stimulus vào viewport.
   */
  async function scrollToVideoTop(group, hooks, onProgress) {
    const pythonScroll = hooks?.pythonScroll;
    const serverScrollIntoView = hooks?.serverScrollIntoView;
    const activeGroup = group || getActiveGroup();
    const target =
      getVideoElement(activeGroup) ||
      activeGroup?.querySelector(".practice-group-question__stimulus") ||
      activeGroup;
    if (!target) return;

    const marginTop = 80;
    const maxY = window.innerHeight * 0.38;
    const baseStep = SCROLL_STEP_MIN + Math.floor(Math.random() * SCROLL_STEP_RANGE);
    const bigStep = baseStep * SCROLL_TO_TOP_MULTIPLIER;

    for (let i = 0; i < 6; i++) {
      const rect = target.getBoundingClientRect();
      if (
        rect.height > 8 &&
        rect.top >= marginTop &&
        rect.top <= maxY &&
        rect.bottom <= window.innerHeight - 40
      ) {
        onProgress?.("Video đã trong vùng nhìn.");
        return;
      }

      if (pythonScroll) {
        let amount = 0;
        if (rect.top < marginTop) {
          amount = Math.max(bigStep, Math.min(2400, Math.round((marginTop - rect.top) * 0.6)));
        } else if (rect.bottom > window.innerHeight - 72) {
          amount = -Math.max(
            bigStep,
            Math.min(2400, Math.round((rect.bottom - window.innerHeight + 72) * 0.6))
          );
        } else if (rect.top > maxY) {
          amount = Math.max(bigStep, Math.min(2400, Math.round((rect.top - maxY) * 0.6)));
        } else break;

        onProgress?.(
          `Cuộn ${amount > 0 ? "lên" : "xuống"} nhanh ×${SCROLL_TO_TOP_MULTIPLIER} (${i + 1})…`
        );
        const anchor = getScrollAnchorScreenCoords();
        await pythonScroll(anchor.screenX, anchor.screenY, amount);
        await sleep(40 + Math.random() * 30);
        continue;
      }

      if (serverScrollIntoView) {
        await serverScrollIntoView(target, onProgress);
      }
      await sleep(40);
    }
  }

  async function syncPanelResultToDb(panel, stimulus, apiUrl, insertApiUrl, onProgress) {
    const AA = window.NCN_AUTO_ANSWER;
    if (!AA) throw new Error("Module trả lời chưa sẵn sàng");

    if (!AA.isPanelIncorrect(panel)) {
      return { synced: false, correct: true };
    }

    const { stimulusTitle, rawQuestion } = buildSimQuizApiFields(
      stimulus,
      panel
    );

    let resolved = AA.findCorrectAnswerIndexFromPanel(panel);
    if (resolved.index == null) {
      await sleep(CORRECT_RESOLVE_MS);
      resolved = AA.findCorrectAnswerIndexFromPanel(panel);
    }

    if (resolved.index == null) {
      onProgress?.(
        `Chưa đọc được đáp án đúng: ${rawQuestion.slice(0, 40)}…`
      );
      return { synced: false, correct: false, reason: "no_correct_index" };
    }

    let apiIdx = null;
    try {
      const api = await fetchSimQuizAnswer(stimulusTitle, rawQuestion, apiUrl);
      if (api?.success && api.found && api.data) {
        apiIdx = AA.resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
      }
    } catch {
      /* ignore */
    }

    if (Number.isInteger(apiIdx) && apiIdx === resolved.index) {
      return { synced: false, correct: false, alreadySynced: true, index: apiIdx };
    }

    const answers = AA.getAnswerOptions(panel);
    const answerText = AA.getAnswerOptionText(answers[resolved.index]);
    onProgress?.(
      `Cập nhật DB index ${resolved.index}: ${(answerText || rawQuestion).slice(0, 48)}…`
    );

    await insertSimQuizAnswer(
      {
        stimulusTitle,
        rawQuestion,
        correctAnswerIndex: resolved.index,
      },
      insertApiUrl
    );

    return {
      synced: true,
      correct: false,
      index: resolved.index,
      answerText,
      source: resolved.source,
    };
  }

  /**
   * Một tình huống: click video → chọn đáp án các câu con → Kiểm tra → sync DB → Tiếp.
   */
  async function runOneSituationViaServer(settings, hooks = {}) {
    const AA = window.NCN_AUTO_ANSWER;
    if (!AA) throw new Error("Module trả lời chưa sẵn sàng");
    if (!isSimulationQuizPage()) {
      throw new Error("Không phải trang Ôn luyện mô phỏng (quiz).");
    }

    const onProgress = hooks.onProgress;
    const serverScrollIntoView = hooks.serverScrollIntoView;
    const shouldStop = hooks.shouldStop;
    const clickApiUrl = settings.clickServerUrl;
    const apiUrl =
      settings.simQuizAnswerApiUrl ||
      "http://localhost:3003/api/simulation-quiz/answer";
    const insertApiUrl =
      settings.simQuizInsertApiUrl ||
      "http://localhost:3003/api/simulation-quiz/insert";
    const debugApiUrl =
      settings.simQuizDebugApiUrl ||
      "http://localhost:3003/api/simulation-quiz/debug";
    const batchApiUrl =
      settings.simQuizInsertBatchApiUrl ||
      "http://localhost:3003/api/simulation-quiz/insert-batch";

    let group = getActiveGroup();
    let situationKey = getSituationKey(group);
    let stimulus = getStimulusText(group);

    onProgress?.(`Tình huống: ${stimulus || situationKey.slice(0, 40) || "?"}`);

    if (isGroupChecked(group) && findEnabledTiepButton()) {
      onProgress?.("Tình huống còn kết quả Kiểm tra — bấm Tiếp trước…");
      const advanced = await clickTiepAfterCheck(
        clickApiUrl,
        serverScrollIntoView,
        onProgress,
        shouldStop
      );
      group = advanced.group || getActiveGroup();
      situationKey = advanced.afterKey || getSituationKey(group);
      stimulus = advanced.stimulus || getStimulusText(group);
      onProgress?.(`Chuyển sang: ${stimulus || situationKey.slice(0, 40) || "?"}`);
      await sleep(500);
    }

    await scrollToVideoTop(group, hooks, onProgress);

    const videoEl = getVideoElement(group);
    if (!videoEl) throw new Error("Không tìm thấy video.");
    await clickElementViaPython(
      videoEl,
      clickApiUrl,
      serverScrollIntoView,
      onProgress,
      "Click video",
      () => getVideoClickCoords(group)
    );
    const videoWatchMs = getSimVideoWatchDelayMs(settings);
    onProgress?.(`Xem video ~${Math.round(videoWatchMs / 1000)}s…`);
    await sleep(videoWatchMs);

    const panels = getSubQuestionPanels(group);
    if (!panels.length) throw new Error("Không có câu hỏi con trong nhóm.");
    const panelWrapperIds = panels.map(getPanelWrapperId).filter(Boolean);

    onProgress?.(`${panels.length} câu — chọn đáp án…`);

    for (let i = 0; i < panels.length; i++) {
      if (shouldStop?.()) throw new Error("STOP_REQUESTED");

      let panel = panels[i];
      if (panel.querySelector('input[type="radio"]:checked')) {
        onProgress?.(`Câu ${i + 1}: đã chọn — bỏ qua`);
        continue;
      }

      if (serverScrollIntoView) {
        await serverScrollIntoView(panel, onProgress);
      }

      const { stimulusTitle, rawQuestion } = buildSimQuizApiFields(
        stimulus,
        panel
      );
      const answers = AA.getAnswerOptions(panel);

      const api = await fetchSimQuizAnswer(stimulusTitle, rawQuestion, apiUrl);
      let pickIndex;
      if (!api?.found || !api?.data) {
        pickIndex = AA.pickRandomAnswerIndex(answers.length);
        onProgress?.(
          `Câu ${i + 1}: chưa DB (${stimulus || "?"}) → chọn đại [${pickIndex}]`
        );
      } else {
        pickIndex = AA.resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
        onProgress?.(`Câu ${i + 1}: DB [${pickIndex}] — ${stimulus || "?"}`);
      }

      const delayMs = getSimAnswerDelayMs(settings);
      if (delayMs > 0) await sleep(delayMs);

      await clickAnswerViaPython(
        panel,
        pickIndex,
        clickApiUrl,
        serverScrollIntoView,
        (t) => onProgress?.(`Câu ${i + 1}: ${t}`)
      );

      await sleep(80 + Math.random() * 120);
    }

    if (shouldStop?.()) throw new Error("STOP_REQUESTED");

    const unanswered = countUnansweredPanels(panels);
    if (unanswered > 0) {
      throw new Error(`Còn ${unanswered} câu chưa chọn đáp án — không Kiểm tra.`);
    }

    await clickKiemTraWithVerify(
      clickApiUrl,
      serverScrollIntoView,
      onProgress,
      shouldStop
    );

    await sleep(800);

    if (shouldStop?.()) throw new Error("STOP_REQUESTED");

    onProgress?.("Chờ trang hiện kết quả…");
    const resultPanels = await waitForCheckResults(group, onProgress, panelWrapperIds);

    if (shouldStop?.()) throw new Error("STOP_REQUESTED");

    const checkPayload = collectCheckResultsPayload(group, stimulus, resultPanels, {
      includeHtml: settings.simQuizDebugEnabled === true,
    });
    onProgress?.(
      `Sau Kiểm tra: ${checkPayload.defaultMatchCount}/${checkPayload.panelCount} câu có đáp án đúng`
    );

    if (settings.simQuizDebugEnabled === true) {
      onProgress?.(`Gửi debug → ${debugApiUrl}`);
      try {
        const debugRes = await postSimQuizDebug(checkPayload, debugApiUrl);
        const savedId = debugRes?.data?.id || debugRes?.id || "?";
        onProgress?.(`Debug đã lưu BE: ${savedId}`);
      } catch (err) {
        onProgress?.(`Lỗi gửi debug (vẫn thử insert): ${err?.message || err}`);
      }
    }

    onProgress?.("Insert kết quả → DB…");
    onProgress?.(`Insert API: ${insertApiUrl}`);

    let syncedCount = 0;
    let syncSummary = [];
    try {
      const sync = await insertFromCheckPayload(
        checkPayload,
        insertApiUrl,
        batchApiUrl,
        onProgress
      );
      syncedCount = sync.syncedCount;
      syncSummary = sync.summary;
    } catch (err) {
      onProgress?.(`Lỗi insert kết quả: ${err?.message || err}`);
      throw err;
    }

    const wrongCount = syncSummary.filter((s) => s.userWrong).length;
    const failedRead = syncSummary.filter((s) => s.reason === "no_correct_index").length;

    if (syncedCount === 0 && failedRead > 0) {
      throw new Error(
        `Không insert được — ${failedRead} câu không đọc default-match. Xem debug/sim-quiz trên BE. Dừng, không bấm Tiếp.`
      );
    }

    const alreadyAll =
      syncedCount === 0 &&
      failedRead === 0 &&
      checkPayload.defaultMatchCount === checkPayload.panelCount;

    onProgress?.(
      syncedCount > 0
        ? `Đã gửi ${syncedCount} đáp án lên BE (${wrongCount} câu sai) — Tiếp…`
        : alreadyAll
          ? `DB đã có đủ ${checkPayload.panelCount} câu — Tiếp…`
          : `Không có gì mới để insert — Tiếp…`
    );

    await sleep(settings.serverNextDelayMinMs ?? 1200);

    const next = await clickTiepAfterCheck(
      clickApiUrl,
      serverScrollIntoView,
      onProgress,
      shouldStop
    );

    await sleep(600);
    await scrollToVideoTop(next.group || getActiveGroup(), hooks, onProgress);

    return {
      ok: true,
      situationKey,
      stimulus: next.stimulus || stimulus,
      panelCount: resultPanels.length,
      syncedCount,
      wrongCount,
      syncSummary,
      nextAttempts: next.nextAttempts,
    };
  }

  window[MODULE_KEY] = {
    isSimulationQuizPage,
    isOldSimulationPage,
    getActiveGroup,
    getScreenTitle,
    getStimulusText,
    buildSimQuizQuestionKey,
    buildSimQuizApiFields,
    fetchSimQuizAnswer,
    insertSimQuizAnswer,
    postSimQuizDebug,
    insertSimQuizBatch,
    collectCheckResultsPayload,
    insertFromCheckPayload,
    getSimAnswerDelayMs,
    getSimVideoWatchDelayMs,
    resolveLivePanel,
    getLiveSubQuestionPanels,
    isPanelAnswerReadable,
    getSubQuestionPanels,
    getSituationKey,
    getVideoElement,
    getVideoClickCoords,
    getAnswerBoxes,
    getSelectedAnswerIndex,
    getAnswerBoxScreenCoords,
    clickAnswerViaPython,
    clickElementViaPython,
    invokePythonClick,
    findButtonByText,
    findPracticeNavButton,
    getButtonScreenCoords,
    getScrollAnchorScreenCoords,
    getScrollDeltaForRect,
    isRectInViewport,
    clientToScreen,
    runOneSituationViaServer,
    waitForCheckResults,
    syncAllPanelResultsToDb,
    readPanelCorrectAnswer,
    findDefaultMatchAnswerIndex,
    collectDefaultMatchesFromGroup,
    clickKiemTraWithVerify,
    panelHasDefaultMatch,
    clickTiepAfterCheck,
    scrollToVideoTop,
    hasPanelCheckResult,
    syncPanelResultToDb,
  };
})();
