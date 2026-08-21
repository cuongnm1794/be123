/**
 * Lấy câu hỏi trong khung .question-panel → API → click đáp án (radio).
 * XPath chỉ dùng class + vị trí [n], không dùng id động.
 */
(function () {
  const SELECTOR_PANEL = ".question-panel";
  const SELECTOR_QUESTION_BLOCK = ".question-content";
  const SELECTOR_ANSWER = ".mc-text-question__radio-answer";

  /** XPath mẫu test (global, không id) */
  const XPATH_QUESTION =
    "//div[contains(@class,'question-content')]//span[contains(@class,'content-display')]";
  const XPATH_ANSWER_GLOBAL =
    "(//div[contains(@class,'mc-text-question__radio-answer')])[{n}]//input[@type='radio']";
  const XPATH_ANSWER_RADIO = "//input[@type='radio']";
  const XPATH_NEXT =
    "//button[contains(@class,'ant-btn')][.//span[normalize-space()='Tiếp']]";
  const XPATH_KET_THUC_LUYEN_THI =
    "//button[contains(@class,'btn-primary')][.//div[contains(@class,'ant-spin-container')][normalize-space()='Kết thúc luyện thi']]";

  const DEFAULT_FEEDBACK_WAIT_MS = 1_000;
  /** Chờ trang báo sai trước khi /insert — LMS thường > 1s */
  const SYNC_FEEDBACK_WAIT_MS = 8_000;
  /** Sau khi trang báo sai, LMS có thể render default-match / correct-box trễ */
  const CORRECT_ANSWER_RESOLVE_WAIT_MS = 5_000;
  const FEEDBACK_POLL_MS = 200;
  /** Giữ kết quả đúng/sai trên status trước khi insert / Tiếp */
  const FEEDBACK_RESULT_DISPLAY_MS = 1_000;
  /** Poll sau server click — check ngay rồi lặp mỗi 100ms */
  const CLICK_ACK_POLL_MS = 100;
  const CLICK_ACK_WAIT_MS = 1_500;
  const NEXT_ACK_WAIT_MS = 2_500;
  const CLICK_RETRY_PAUSE_MS = 200;
  const NEXT_RETRY_PAUSE_MS = 300;

  function normalizeQuestion(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("vi");
  }

  /** ID ổn định từ URL ảnh trong câu hỏi — phân biệt câu trùng chữ khác hình */
  function getQuestionImageKeys(panel) {
    const root = panel || findActiveQuestionPanel();
    const block = root.querySelector(SELECTOR_QUESTION_BLOCK);
    if (!block) return [];

    const keys = new Set();
    block.querySelectorAll("img[src], img[alt]").forEach((img) => {
      const src = (img.getAttribute("src") || img.getAttribute("alt") || "").trim();
      if (!src) return;
      const idMatch = src.match(/\/([a-f0-9]{16,})\.(?:png|jpe?g|gif|webp)/i);
      keys.add(idMatch ? idMatch[1] : src.split("/").pop() || src);
    });

    return [...keys].sort();
  }

  /** Khóa gửi BE: text + fingerprint ảnh (nếu có) */
  function buildQuestionForApi(rawQuestion, panel) {
    const images = getQuestionImageKeys(panel);
    if (!images.length) return normalizeQuestion(rawQuestion);
    return normalizeQuestion(`${rawQuestion} [img:${images.join("|")}]`);
  }

  function countReadableChars(text) {
    return String(text || "").replace(/\s+/g, " ").trim().length;
  }

  /**
   * Delay ngẫu nhiên trước khi chọn đáp án (min–max ms).
   */
  function computeAnswerDelayMs(options = {}) {
    const minMs = Math.max(
      0,
      Number(options.answerDelayMinMs) ?? DEFAULT_ANSWER_DELAY_MIN_MS
    );
    const maxMs = Math.max(
      minMs,
      Number(options.answerDelayMaxMs) ?? DEFAULT_ANSWER_DELAY_MAX_MS
    );
    return randomDelayMs(minMs, maxMs);
  }

  /** @deprecated Giữ tên cũ — giờ chỉ random min/max */
  function computeReadingDelayMs(_panel, _rawQuestion, options = {}) {
    return computeAnswerDelayMs(options);
  }

  function getQuestionPanels() {
    return [...document.querySelectorAll(SELECTOR_PANEL)];
  }

  /** Vị trí 1-based của panel trong danh sách .question-panel */
  function getPanelPosition(panel) {
    const panels = getQuestionPanels();
    const i = panels.indexOf(panel);
    return i >= 0 ? i + 1 : 1;
  }

  function findActiveQuestionPanel() {
    const panels = getQuestionPanels();
    if (!panels.length) {
      throw new Error("Không tìm thấy khung câu hỏi (.question-panel).");
    }

    const unanswered = panels.filter(
      (p) => !p.querySelector('input[type="radio"]:checked')
    );
    const pool = unanswered.length ? unanswered : panels;

    const inView = pool.find((p) => {
      const r = p.getBoundingClientRect();
      return r.top < window.innerHeight * 0.85 && r.bottom > 80;
    });

    return inView || pool[0];
  }

  function buildQuestionXPath(panel) {
    const p = getPanelPosition(panel || findActiveQuestionPanel());
    return `(//div[contains(@class,'question-panel')])[${p}]//div[contains(@class,'question-content')]//span[contains(@class,'content-display')]`;
  }

  function buildAnswerXPath(panel, answerIndex0) {
    const a = Number(answerIndex0) + 1;
    if (panel) {
      const p = getPanelPosition(panel);
      return `(//div[contains(@class,'question-panel')])[${p}]//div[contains(@class,'mc-text-question__radio-answer')][${a}]${XPATH_ANSWER_RADIO}`;
    }
    return XPATH_ANSWER_GLOBAL.replace("{n}", String(a));
  }

  function getQuestionTitle(panel) {
    const root = panel || findActiveQuestionPanel();
    const header =
      root.querySelector(".question-panel__header-text") ||
      root.querySelector('[id^="question-header-"]');

    if (!header) return "";

    const clone = header.cloneNode(true);
    clone
      .querySelectorAll("i, .anticon, svg, [class*='icon'], [class*='Icon']")
      .forEach((node) => node.remove());

    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getQuestionText(panel) {
    const root = panel || findActiveQuestionPanel();
    const block = root.querySelector(SELECTOR_QUESTION_BLOCK);
    if (!block) {
      throw new Error("Không có .question-content trong câu hỏi.");
    }

    const displays = block.querySelectorAll("span.content-display");
    for (const span of displays) {
      if (span.closest(".mc-text-question")) continue;
      const text = (span.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 5) return text;
    }

    throw new Error("Không đọc được nội dung câu hỏi (.question-content .content-display).");
  }

  function getAnswerOptions(panel) {
    const root = panel || findActiveQuestionPanel();
    return [...root.querySelectorAll(SELECTOR_ANSWER)];
  }

  function xpathForElement(panel, element) {
    const answers = getAnswerOptions(panel);
    const box = element.closest(SELECTOR_ANSWER) || element;
    const i = answers.indexOf(box);
    if (i >= 0) return buildAnswerXPath(panel, i);
    return "";
  }

  /**
   * correctAnswerIndex từ API: ưu tiên khớp input[value], sau đó 0-based, cuối 1-based.
   */
  function resolveAnswerElement(panel, correctAnswerIndex) {
    const idx = Number(correctAnswerIndex);
    if (!Number.isFinite(idx)) {
      throw new Error(`correctAnswerIndex không hợp lệ: ${correctAnswerIndex}`);
    }

    const root = panel || findActiveQuestionPanel();
    const answers = getAnswerOptions(root);

    if (!answers.length) {
      throw new Error(
        `Không thấy đáp án (${SELECTOR_ANSWER}) trong khung câu hỏi hiện tại.`
      );
    }

    if (idx >= 0 && idx < answers.length) {
      return answers[idx].querySelector('input[type="radio"]') || answers[idx];
    }

    if (idx >= 1 && idx <= answers.length) {
      const box = answers[idx - 1];
      return box.querySelector('input[type="radio"]') || box;
    }

    const radioByValue = root.querySelector(
      `input[type="radio"][value="${idx}"]`
    );
    if (radioByValue) {
      return radioByValue;
    }

    throw new Error(
      `Đáp án index ${idx} không tồn tại (có ${answers.length} lựa chọn, dùng 0–${answers.length - 1} hoặc value trên radio).`
    );
  }

  function assertDomInteractionAllowed() {
    if (window.NCN_PAGE_READ_ONLY) {
      throw new Error(
        "Không click/scroll DOM trên trang — dùng server click (popup)."
      );
    }
  }

  function clickAnswerElement(element, answerXPath) {
    assertDomInteractionAllowed();
    if (answerXPath && window.NCN_XPATH?.clickByXPath) {
      return window.NCN_XPATH.clickByXPath(answerXPath);
    }

    const radio = element.matches('input[type="radio"]')
      ? element
      : element.querySelector('input[type="radio"]');

    const target = radio || element;
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });

    if (window.NCN_XPATH?.simulateMouseClick) {
      window.NCN_XPATH.simulateMouseClick(target);
    } else {
      target.click();
    }

    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event("input", { bubbles: true }));
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return {
      ok: true,
      tag: target.tagName,
      value: radio?.value ?? null,
      text: (target.closest(SELECTOR_ANSWER)?.textContent || target.textContent || "")
        .trim()
        .slice(0, 80),
    };
  }

  function clickNextButton() {
    assertDomInteractionAllowed();
    if (!window.NCN_XPATH?.getElementByXPath) {
      throw new Error("Module click chưa sẵn sàng.");
    }
    const element = window.NCN_XPATH.getElementByXPath(XPATH_NEXT);
    window.NCN_XPATH.simulateMouseClick(element, { nativeOnly: true });

    return {
      ok: true,
      xpath: XPATH_NEXT,
      tag: element.tagName,
      text: (element.textContent || "").trim().slice(0, 80),
    };
  }

  /** Tọa độ nút Tiếp — ngẫu nhiên trong khung nút, không click DOM */
  function getNextButtonClickCoordinates(options = {}) {
    if (!window.NCN_XPATH?.getElementByXPath) {
      throw new Error("Module XPath chưa sẵn sàng.");
    }
    const element = window.NCN_XPATH.getElementByXPath(XPATH_NEXT);
    const serverClick = options.serverClick === true;
    const coords = getElementClickCoordinates(element, {
      randomize: options.randomize !== false,
      serverClick,
      skipScroll: serverClick,
      requireInViewport: options.requireInViewport !== false,
    });
    return {
      ok: true,
      coords,
      xpath: XPATH_NEXT,
      tag: element.tagName,
      text: (element.textContent || "").trim().slice(0, 80),
    };
  }

  /** Tọa độ nút Kết thúc luyện thi — ngẫu nhiên trong khung nút, không click DOM */
  function getKetThucLuyenThiClickCoordinates(options = {}) {
    if (!window.NCN_XPATH?.getElementByXPath) {
      throw new Error("Module XPath chưa sẵn sàng.");
    }
    const element = window.NCN_XPATH.getElementByXPath(XPATH_KET_THUC_LUYEN_THI);
    if (!element) {
      throw new Error("Không tìm thấy nút Kết thúc luyện thi.");
    }
    const serverClick = options.serverClick === true;
    const coords = getElementClickCoordinates(element, {
      randomize: options.randomize !== false,
      serverClick,
      skipScroll: serverClick,
      requireInViewport: options.requireInViewport !== false,
    });
    return {
      ok: true,
      coords,
      xpath: XPATH_KET_THUC_LUYEN_THI,
      tag: element.tagName,
      text: (element.textContent || "").trim().slice(0, 80),
    };
  }

  async function serverClickKetThucLuyenThi(clickApiUrl, options = {}) {
    const onProgress = options.onProgress;
    if (onProgress) onProgress("Click Kết thúc luyện thi…");

    const kq = getKetThucLuyenThiClickCoordinates({
      randomize: true,
      serverClick: true,
    });

    const click = await invokeAutoClickServer(
      kq.coords.screenX,
      kq.coords.screenY,
      clickApiUrl
    );

    window.NCN_LOG?.log("flow", "Đã click Kết thúc luyện thi", {
      screenX: kq.coords.screenX,
      screenY: kq.coords.screenY,
    });

    return {
      ok: true,
      click,
      coords: kq.coords,
    };
  }

  function randomDelayMs(minMs, maxMs) {
    const min = Math.min(minMs, maxMs);
    const max = Math.max(minMs, maxMs);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitWithCountdown(delayMs, onProgress, label) {
    const total = Math.max(0, Number(delayMs) || 0);
    if (total === 0) return;

    const end = Date.now() + total;
    while (Date.now() < end) {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (onProgress) onProgress(`${label} (${left}s)…`);
      await sleep(Math.min(1000, end - Date.now()));
    }
  }

  async function alertQuestionNotFound(options = {}) {
    if (options.alertOnNotFound === false) return;

    try {
      if (window.NCN_ALERT?.playNotFoundChimes) {
        await window.NCN_ALERT.playNotFoundChimes();
      }
    } catch (err) {
      console.warn("[NCN] Không phát được chuông cảnh báo:", err);
    }

    chrome.runtime
      .sendMessage({ type: "QUESTION_NOT_FOUND_ALERT" })
      .catch(() => {});
  }

  async function fetchAnswerFromApi(questionTitle, questionNorm, apiUrl) {
    const url = (apiUrl || "").trim() || "(answer API)";
    const body = {
      questionTitle: questionTitle || "",
      question: questionNorm,
    };
    window.NCN_LOG?.log("api", `POST ${url} → /answer`, body);

    const res = await chrome.runtime.sendMessage({
      type: "FETCH_ANSWER",
      questionTitle: body.questionTitle,
      question: body.question,
      apiUrl,
    });

    if (!res?.ok) {
      window.NCN_LOG?.logApi("POST", "/answer", body, null, res?.error || "thất bại");
      throw new Error(res?.error || "Gọi API thất bại");
    }
    window.NCN_LOG?.logApi("POST", "/answer", body, res.data);
    return res.data;
  }

  async function insertAnswerToApi(payload, insertApiUrl) {
    const url = (insertApiUrl || "").trim() || "(insert API)";
    const body = {
      questionTitle: payload.questionTitle || "",
      question:
        payload.questionNorm ||
        buildQuestionForApi(payload.question, payload.panel),
      answerPosition: Math.max(0, Math.floor(Number(payload.answerPosition))),
    };
    window.NCN_LOG?.log("api", `POST ${url} → /insert`, body);

    const res = await chrome.runtime.sendMessage({
      type: "FETCH_INSERT",
      payload: body,
      insertApiUrl,
    });

    if (!res?.ok) {
      window.NCN_LOG?.logApi("POST", "/insert", body, null, res?.error || "thất bại");
      throw new Error(res?.error || "Gọi API insert thất bại");
    }
    window.NCN_LOG?.logApi("POST", "/insert", body, res.data);
    return res.data;
  }

  function normalizeCompareText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("vi")
      .replace(/^\d+\s*[-.)]\s*/i, "");
  }

  function getAnswerOptionText(answerEl) {
    const display = answerEl.querySelector(".content-display");
    return (display?.textContent || answerEl.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const CLASS_HEADER_INCORRECT = "question-header-incorrect-icon";
  const CLASS_HEADER_CORRECT = "question-header-correct-icon";
  const CLASS_PANEL_INCORRECT = "question-panel--incorrect";
  const CLASS_PANEL_CORRECT = "question-panel--correct";
  const CLASS_ANSWER_MATCH = "default-match";

  const DEFAULT_ANSWER_DELAY_MIN_MS = 3_000;
  const DEFAULT_ANSWER_DELAY_MAX_MS = 8_000;

  function getPanelSource(panel) {
    const root = panel?.isConnected ? panel : findAnsweredQuestionPanel(panel);
    if (root?.isConnected) return root.outerHTML || "";

    const panelId = panel?.id || panel?.querySelector?.("[id^='question-wrapper-id-']")?.id;
    if (panelId) {
      const live = document.getElementById(panelId);
      const livePanel = live?.closest?.(SELECTOR_PANEL) || live;
      if (livePanel?.isConnected) return livePanel.outerHTML || "";
    }

    return panel?.outerHTML || "";
  }

  function getQuestionHeaderSource(panel) {
    const root = panel?.isConnected ? panel : findAnsweredQuestionPanel(panel);
    const header =
      root?.querySelector(".question-panel__header-text") ||
      root?.querySelector('[id^="question-header-"]');
    if (header?.isConnected) return header.outerHTML || "";
    const headerId = header?.id || root?.querySelector('[id^="question-header-"]')?.id;
    if (headerId) {
      const liveHeader = document.getElementById(headerId);
      if (liveHeader?.isConnected) return liveHeader.outerHTML || "";
    }
    return getPanelSource(root);
  }

  function findAnsweredQuestionPanel(hintPanel = null) {
    const panels = getQuestionPanels().filter((p) => p.isConnected);

    const checked = panels.filter((p) =>
      p.querySelector('input[type="radio"]:checked')
    );
    if (checked.length === 1) return checked[0];

    if (checked.length > 1) {
      const inView = checked.find((p) => {
        const r = p.getBoundingClientRect();
        return r.top < window.innerHeight * 0.85 && r.bottom > 80;
      });
      if (inView) return inView;
      return checked[0];
    }

    const headerId = hintPanel?.querySelector('[id^="question-header-"]')?.id;
    if (headerId) {
      const header = document.getElementById(headerId);
      const livePanel = header?.closest?.(SELECTOR_PANEL);
      if (livePanel?.isConnected) return livePanel;
    }

    const wrapperId = hintPanel?.id;
    if (wrapperId) {
      const wrapper = document.getElementById(wrapperId);
      const livePanel = wrapper?.closest?.(SELECTOR_PANEL) || wrapper;
      if (livePanel?.isConnected && livePanel.matches?.(SELECTOR_PANEL)) {
        return livePanel;
      }
    }

    if (hintPanel?.isConnected) return hintPanel;
    return findActiveQuestionPanel();
  }

  function hasPanelFeedbackClasses(panelHtml) {
    return (
      panelHtml.includes(CLASS_PANEL_INCORRECT) ||
      panelHtml.includes(CLASS_PANEL_CORRECT)
    );
  }

  function hasHeaderFeedbackIcons(panel) {
    if (!panel?.isConnected) return false;
    const panelHtml = getPanelSource(panel);
    const headerHtml = getQuestionHeaderSource(panel);
    return (
      panelHtml.includes(CLASS_HEADER_INCORRECT) ||
      headerHtml.includes(CLASS_HEADER_CORRECT) ||
      hasPanelFeedbackClasses(panelHtml)
    );
  }

  function getPanelAnswerVerdict(panelHint, options = {}) {
    const panel = options.panel || findAnsweredQuestionPanel(panelHint);
    const panelHtml = getPanelSource(panel);
    const headerHtml = getQuestionHeaderSource(panel);

    if (
      panelHtml.includes(CLASS_HEADER_INCORRECT) ||
      panelHtml.includes(CLASS_PANEL_INCORRECT)
    ) {
      return "incorrect";
    }
    if (headerHtml.includes(CLASS_HEADER_CORRECT)) {
      return headerHtml.includes("ve-close-outline") ? "incorrect" : "correct";
    }
    if (panelHtml.includes(CLASS_PANEL_CORRECT)) {
      return "correct";
    }
    return null;
  }

  function isPanelIncorrect(panel) {
    return getPanelAnswerVerdict(panel) === "incorrect";
  }

  function isPanelCorrect(panel) {
    return getPanelAnswerVerdict(panel) === "correct";
  }

  function hasAnswerFeedback(panelHint) {
    const panel = findAnsweredQuestionPanel(panelHint);
    if (!panel?.isConnected) return false;
    return hasHeaderFeedbackIcons(panel);
  }

  function getCorrectAnswerTextFromPanel(panel) {
    const root = findAnsweredQuestionPanel(panel);
    const box = root.querySelector(".correct-answer-box");
    if (!box) return "";

    const labelEl = [...box.querySelectorAll(".text-bold")].find((el) =>
      /câu\s+trả\s+lời\s+chính\s+xác/i.test(el.textContent || "")
    );
    if (labelEl) {
      const siblingText = (labelEl.nextSibling?.textContent || "").trim();
      if (siblingText) return siblingText;

      const parent = labelEl.parentElement;
      if (parent) {
        const parts = [...parent.childNodes]
          .map((node) => (node === labelEl ? "" : node.textContent || ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const inline = parts.match(/câu\s+trả\s+lời\s+chính\s+xác\s+là:\s*(.+)$/i);
        if (inline?.[1]) return inline[1].trim();
      }
    }

    const clone = box.cloneNode(true);
    clone
      .querySelectorAll(
        ".ve-close-outline, [class*='icon'], i, svg, .text-danger"
      )
      .forEach((node) => node.remove());

    const text = (clone.textContent || "").replace(/\s+/g, " ");
    const match = text.match(
      /câu\s+trả\s+lời\s+chính\s+xác\s+là:?\s*(.+)$/i
    );
    if (match) return match[1].trim();

    const inlineParts = [...box.childNodes]
      .map((node) => node.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const inlineMatch = inlineParts.match(
      /câu\s+trả\s+lời\s+chính\s+xác\s+là:?\s*(.+)$/i
    );
    if (inlineMatch) return inlineMatch[1].trim();

    return text
      .replace(/chưa\s+chính\s+xác/gi, "")
      .replace(/câu\s+trả\s+lời\s+chính\s+xác\s+là:?/gi, "")
      .trim();
  }

  function getSelectedAnswerIndex(panel) {
    const answers = getAnswerOptions(panel);
    for (let i = 0; i < answers.length; i++) {
      const radio = answers[i].querySelector('input[type="radio"]');
      if (radio?.checked) return i;
    }
    return null;
  }

  function formatCheckMessage(result) {
    if (result.correct) {
      return `ĐÚNG — ${result.selectedText || `index ${result.selectedIndex}`}`;
    }
    const correctPart = result.correctText
      ? `Đáp án đúng: ${result.correctText}`
      : result.correctIndex !== null && result.correctIndex !== undefined
        ? `Đáp án đúng: index ${result.correctIndex}`
        : "Không đọc được đáp án đúng";
    return `SAI — ${correctPart}`;
  }

  function findAnswerPositionByLabel(panel, correctLabel) {
    const answers = getAnswerOptions(panel);
    const target = normalizeCompareText(correctLabel);
    const targetRaw = String(correctLabel || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("vi");
    if (!target || !answers.length) return null;

    const numMatch = String(correctLabel || "").match(/^(\d+)\s*[-.)]/);
    if (numMatch) {
      const n = Number(numMatch[1]);
      if (n >= 1 && n <= answers.length) {
        const candidateIdx = n - 1;
        const candidateNorm = normalizeCompareText(
          getAnswerOptionText(answers[candidateIdx])
        );
        if (
          candidateNorm === target ||
          candidateNorm.includes(target) ||
          target.includes(candidateNorm)
        ) {
          return candidateIdx;
        }
      }
    }

    let bestIdx = null;
    let bestScore = 0;

    for (let i = 0; i < answers.length; i++) {
      const rawLabel = getAnswerOptionText(answers[i]);
      const label = normalizeCompareText(rawLabel);
      const rawNorm = rawLabel.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
      if (!label) continue;

      let score = 0;
      if (label === target || rawNorm === targetRaw) score = 100;
      else if (label.includes(target) && target.length >= 4) score = 70 + target.length;
      else if (target.includes(label) && label.length >= Math.max(10, target.length * 0.6)) {
        score = 55 + label.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    return bestScore >= 55 ? bestIdx : null;
  }

  /** Dải Y hẹp — đáp án: chỉ hàng radio (không dùng .content-display cao cả block) */
  function getTightVerticalBand(container, boxRect) {
    const isAnswerRow =
      container.matches?.(SELECTOR_ANSWER) ||
      Boolean(container.closest?.(SELECTOR_ANSWER));

    const selectors = isAnswerRow
      ? ['input[type="radio"]', ".ant-radio", ".ant-radio-wrapper", "label"]
      : container.matches?.("button,[class*='ant-btn']")
        ? []
        : ["button", '[class*="ant-btn"]', "label"];

    let top = boxRect.bottom;
    let bottom = boxRect.top;
    let found = false;

    for (const sel of selectors) {
      container.querySelectorAll(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
        found = true;
      });
    }

    if (!found || top >= bottom) {
      const h = boxRect.height;
      const mid = boxRect.top + h / 2;
      const half = Math.max(4, Math.min(h * 0.35, h / 2 - 1));
      return { top: mid - half, bottom: mid + half };
    }

    const bandH = bottom - top;
    const maxBand = Math.max(boxRect.height * 0.55, 28);
    if (bandH > maxBand) {
      const mid = (top + bottom) / 2;
      top = mid - maxBand / 2;
      bottom = mid + maxBand / 2;
    }

    return {
      top: Math.max(boxRect.top, top),
      bottom: Math.min(boxRect.bottom, bottom),
    };
  }

  function clampClientPointToRect(clientX, clientY, rect) {
    return {
      clientX: Math.min(
        Math.max(Math.round(clientX), Math.ceil(rect.left) + 1),
        Math.floor(rect.right) - 1
      ),
      clientY: Math.min(
        Math.max(Math.round(clientY), Math.ceil(rect.top) + 1),
        Math.floor(rect.bottom) - 1
      ),
    };
  }

  function isPointInsideContainer(clientX, clientY, container) {
    const hit = document.elementFromPoint(clientX, clientY);
    return Boolean(hit && container.contains(hit));
  }

  const ANSWER_X_MIN_RATIO = 0.05;
  const ANSWER_X_MAX_RATIO = 0.2;

  function collectClickTargetRects(container) {
    const seen = new Set();
    const rects = [];
    const selectors = [
      'input[type="radio"]',
      ".ant-radio-inner",
      ".ant-radio",
      ".ant-radio-wrapper",
      "label",
    ];

    for (const sel of selectors) {
      container.querySelectorAll(sel).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) rects.push(r);
      });
    }
    return rects;
  }

  /** Vùng X: 5–20% bề ngang ô, ưu tiên khối radio/label (không tràn sang text dài) */
  function getAnswerClickZone(container, boxRect) {
    const ratioMin = boxRect.left + boxRect.width * ANSWER_X_MIN_RATIO;
    const ratioMax = boxRect.left + boxRect.width * ANSWER_X_MAX_RATIO;
    const targets = collectClickTargetRects(container);

    if (targets.length) {
      let left = Math.min(...targets.map((r) => r.left));
      let right = Math.max(...targets.map((r) => r.right));
      let top = Math.min(...targets.map((r) => r.top));
      let bottom = Math.max(...targets.map((r) => r.bottom));

      left = Math.max(boxRect.left + 2, Math.min(left, ratioMax - 6));
      right = Math.min(right, ratioMax);
      right = Math.max(right, left + 6);
      left = Math.max(ratioMin, Math.min(left, right - 6));

      return { xMin: left, xMax: right, top, bottom, fromTargets: true };
    }

    return {
      xMin: ratioMin,
      xMax: Math.max(ratioMin + 8, ratioMax),
      top: boxRect.top,
      bottom: boxRect.bottom,
      fromTargets: false,
    };
  }

  function isPointOnAnswerClickTarget(clientX, clientY, container) {
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit || !container.contains(hit)) return false;
    return Boolean(
      hit.closest(
        'input[type="radio"], .ant-radio-inner, .ant-radio, .ant-radio-wrapper, label'
      )
    );
  }

  /**
   * Đáp án: X random 5–20% từ trái (vùng radio), Y random; phải trúng radio/label.
   * Nút Tiếp: X/Y random trong khung nút.
   */
  function randomPointInClickArea(container, padRatio = { x: 0.06, y: 0.08 }) {
    const boxRect = container.getBoundingClientRect();
    const isAnswerRow =
      container.matches?.(SELECTOR_ANSWER) ||
      Boolean(container.closest?.(SELECTOR_ANSWER));

    let xMin;
    let xMax;
    let yMin;
    let yMax;
    let yMid;

    if (isAnswerRow) {
      const zone = getAnswerClickZone(container, boxRect);
      const band = getTightVerticalBand(container, boxRect);
      xMin = zone.xMin;
      xMax = zone.xMax;
      yMin = Math.max(zone.top, band.top);
      yMax = Math.min(zone.bottom, band.bottom);
      if (yMax <= yMin) {
        yMin = band.top;
        yMax = band.bottom;
      }
      const bandH = Math.max(1, yMax - yMin);
      const padY = Math.max(2, Math.floor(bandH * padRatio.y));
      yMin += padY;
      yMax -= padY;
      if (yMax <= yMin) {
        yMid = (zone.top + zone.bottom) / 2;
        yMin = yMid - 2;
        yMax = yMid + 2;
      } else {
        yMid = (yMin + yMax) / 2;
      }
    } else {
      const band = getTightVerticalBand(container, boxRect);
      const padX = Math.max(4, Math.floor(boxRect.width * padRatio.x));
      xMin = boxRect.left + padX;
      xMax = boxRect.right - padX;
      if (xMax <= xMin) {
        xMin = boxRect.left + 1;
        xMax = boxRect.right - 1;
      }
      const bandH = Math.max(1, band.bottom - band.top);
      const padY = Math.max(2, Math.floor(bandH * padRatio.y));
      yMin = band.top + padY;
      yMax = band.bottom - padY;
      if (yMax <= yMin) {
        yMid = (band.top + band.bottom) / 2;
        yMin = yMid - 3;
        yMax = yMid + 3;
      } else {
        yMid = (band.top + band.bottom) / 2;
      }
    }

    const hitTest = isAnswerRow
      ? (x, y) => isPointOnAnswerClickTarget(x, y, container)
      : (x, y) => isPointInsideContainer(x, y, container);

    for (let attempt = 0; attempt < 16; attempt++) {
      const clientX = Math.round(xMin + Math.random() * (xMax - xMin));
      let clientY;
      if (attempt < 10) {
        clientY = Math.round(yMin + Math.random() * (yMax - yMin));
      } else {
        clientY = Math.round(yMid);
      }

      const clamped = clampClientPointToRect(clientX, clientY, boxRect);
      if (hitTest(clamped.clientX, clamped.clientY)) {
        return clamped;
      }
    }

    if (isAnswerRow) {
      const radio = container.querySelector(
        'input[type="radio"], .ant-radio-wrapper, .ant-radio'
      );
      if (radio) {
        const r = radio.getBoundingClientRect();
        return clampClientPointToRect(
          r.left + r.width / 2,
          r.top + r.height / 2,
          boxRect
        );
      }
    }

    const fallbackX = Math.round((xMin + xMax) / 2);
    return clampClientPointToRect(fallbackX, yMid, boxRect);
  }

  function clientToScreen(clientX, clientY) {
    const borderLeft = window.outerWidth - window.innerWidth;
    const borderTop = window.outerHeight - window.innerHeight;
    return {
      screenX: Math.round(window.screenX + borderLeft + clientX),
      screenY: Math.round(window.screenY + borderTop + clientY),
    };
  }

  function isRectInViewport(rect, margin = 6) {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    return (
      rect.top >= -margin &&
      rect.left >= -margin &&
      rect.bottom <= window.innerHeight + margin &&
      rect.right <= window.innerWidth + margin
    );
  }

  /** Tọa độ trong khung đáp án — x/y ngẫu nhiên trong vùng .mc-text-question__radio-answer */
  function getElementClickCoordinates(element, options = {}) {
    const randomize = options.randomize !== false;
    const serverClick = options.serverClick === true || options.skipScroll === true;
    const box =
      element.closest?.(SELECTOR_ANSWER) ||
      (element.matches?.(SELECTOR_ANSWER) ? element : null) ||
      element;

    if (!box?.getBoundingClientRect) {
      throw new Error("Không lấy được vị trí phần tử đáp án.");
    }

    if (window.NCN_PAGE_READ_ONLY && !serverClick) {
      throw new Error(
        "Không scroll script trên trang — bật server click hoặc scroll tay."
      );
    }

    if (!serverClick) {
      box.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    }

    const rect = box.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) {
      throw new Error(
        serverClick
          ? "Phần tử không hiển thị — scroll tay (extension không scroll script)."
          : "Đáp án không hiển thị (kích thước 0)."
      );
    }

    if (serverClick && options.requireInViewport !== false && !isRectInViewport(rect)) {
      throw new Error(
        "Phần tử ngoài viewport — không scroll script. Scroll tay hoặc dùng Loop scroll."
      );
    }

    const point = randomize
      ? randomPointInClickArea(box)
      : clampClientPointToRect(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          rect
        );
    const screen = clientToScreen(point.clientX, point.clientY);

    const band = getTightVerticalBand(box, rect);

    return {
      ...point,
      ...screen,
      randomize,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      clickBandTop: Math.round(band.top),
      clickBandBottom: Math.round(band.bottom),
    };
  }

  function formatCoordsMessage(result, answerClickUrl = "", nextBlock = null) {
    const { index, source, coords, answerText } = result;
    const preview = answerText
      ? answerText.slice(0, 48) + (answerText.length > 48 ? "…" : "")
      : "";
    const lines = [`Đúng: index ${index} (${source})`];
    if (preview) lines.push(`  ${preview}`);
    lines.push(
      `đáp án: ${coords.screenX}, ${coords.screenY}${coords.randomize !== false ? " (ngẫu nhiên)" : ""}`,
      `client: ${coords.clientX}, ${coords.clientY}`,
      `vùng: ${coords.width}×${coords.height}px`
    );
    if (answerClickUrl) lines.push("", answerClickUrl);
    if (nextBlock) {
      lines.push(
        "",
        `Chờ ${Math.round((nextBlock.waitMs || 0) / 1000)}s`,
        `Tiếp: ${nextBlock.coords.screenX}, ${nextBlock.coords.screenY}${nextBlock.coords.randomize !== false ? " (ngẫu nhiên)" : ""}`
      );
      if (nextBlock.clickUrl) lines.push(nextBlock.clickUrl);
    }
    return lines.join("\n");
  }

  /**
   * Tọa độ click đáp án đúng — ưu tiên trang (sai → default-match), không có thì DB.
   * Chỉ đọc DOM, không click.
   */
  async function getCorrectAnswerCoordinates(apiUrl, options = {}) {
    const onProgress = options.onProgress;
    let panel = findActiveQuestionPanel();

    let index = null;
    let source = null;
    let answerText = null;

    if (onProgress) onProgress("Đọc đáp án đúng trên trang…");
    const pageResolved = findCorrectAnswerIndexFromPanel(panel);
    if (pageResolved.index !== null && pageResolved.index !== undefined) {
      index = pageResolved.index;
      source = pageResolved.source;
      answerText = pageResolved.correctText;
      panel = findAnsweredQuestionPanel(panel);
    }

    if (index === null || index === undefined) {
      if (onProgress) onProgress("Chưa thấy trên trang — hỏi BE…");
      const questionTitle = getQuestionTitle(panel);
      const rawQuestion = getQuestionText(panel);
      const questionNorm = buildQuestionForApi(rawQuestion, panel);
      const api = await fetchAnswerFromApi(questionTitle, questionNorm, apiUrl);

      if (!api?.success) throw new Error("API trả success=false");
      if (!api.found || !api.data) {
        throw new Error(
          "Chưa có đáp án đúng — Tra index / bấm sai trên trang để hiện đáp án đúng."
        );
      }

      index = resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
      source = "db";
      answerText = getAnswerOptionText(getAnswerOptions(panel)[index]);
    }

    const answerEl = resolveAnswerElement(panel, index);
    const coords = getElementClickCoordinates(answerEl, {
      randomize: options.randomize !== false,
      serverClick: true,
      skipScroll: true,
    });

    const result = {
      ok: true,
      index,
      source,
      answerText,
      coords,
      answerXPath: buildAnswerXPath(panel, index),
      message: "",
    };
    result.message = formatCoordsMessage(result);
    return result;
  }

  /** Ưu tiên class default-match của LMS, sau đó parse correct-answer-box */
  function findCorrectAnswerIndexFromPanel(panel) {
    const root = findAnsweredQuestionPanel(panel);
    const answers = getAnswerOptions(root);

    for (let i = 0; i < answers.length; i++) {
      if (answers[i].classList.contains(CLASS_ANSWER_MATCH)) {
        return {
          index: i,
          source: "default-match",
          correctText: getAnswerOptionText(answers[i]),
        };
      }
    }

    const correctText = getCorrectAnswerTextFromPanel(root);
    if (correctText) {
      const idx = findAnswerPositionByLabel(root, correctText);
      if (idx !== null && idx !== undefined) {
        return { index: idx, source: "correct-box", correctText };
      }
    }

    return { index: null, source: null, correctText: correctText || null };
  }

  /** Poll đáp án đúng trên trang — default-match thường xuất hiện sau icon sai */
  async function waitForCorrectAnswerIndexFromPanel(
    panelHint,
    maxWaitMs = CORRECT_ANSWER_RESOLVE_WAIT_MS,
    onProgress
  ) {
    const total = Math.max(500, Number(maxWaitMs) || CORRECT_ANSWER_RESOLVE_WAIT_MS);
    const start = Date.now();
    let panel = findAnsweredQuestionPanel(panelHint);
    let resolved = findCorrectAnswerIndexFromPanel(panel);

    while (Date.now() - start < total) {
      panel = findAnsweredQuestionPanel(panelHint);
      resolved = findCorrectAnswerIndexFromPanel(panel);
      if (resolved.index !== null && resolved.index !== undefined) {
        return { ...resolved, panel };
      }
      if (onProgress) onProgress("Chờ trang hiện đáp án đúng…");
      await sleep(FEEDBACK_POLL_MS);
    }

    return { ...resolved, panel };
  }

  async function waitForAnswerFeedback(panelHint, maxWaitMs, onProgress) {
    const total = Math.max(500, Number(maxWaitMs) || DEFAULT_FEEDBACK_WAIT_MS);
    const start = Date.now();
    let panel = findAnsweredQuestionPanel(panelHint);

    while (Date.now() - start < total) {
      panel = findAnsweredQuestionPanel(panelHint);
      if (hasHeaderFeedbackIcons(panel)) {
        return { ok: true, panel };
      }
      if (onProgress) onProgress("Chờ kết quả đúng/sai…");
      await sleep(FEEDBACK_POLL_MS);
    }

    panel = findAnsweredQuestionPanel(panelHint);
    return { ok: hasHeaderFeedbackIcons(panel), panel };
  }

  function formatPageFeedbackStatus(panel, feedback) {
    if (feedback?.reason === "feedback_timeout") {
      return (
        feedback.skipNote ||
        "Kết quả: Chưa thấy đúng/sai trên trang (hết thời gian chờ)"
      );
    }

    if (!isPanelIncorrect(panel)) {
      return "Kết quả: ĐÚNG ✓ — question-header-correct-icon";
    }

    const correctText =
      feedback?.correctText || getCorrectAnswerTextFromPanel(panel);
    let idx = feedback?.answerPosition;
    if (idx === null || idx === undefined) {
      idx = findAnswerPositionByLabel(panel, correctText);
    }

    const idxPart =
      idx !== null && idx !== undefined ? ` — index đúng: ${idx}` : "";
    const textPart = correctText
      ? ` — ${correctText.slice(0, 55)}${correctText.length > 55 ? "…" : ""}`
      : "";

    if (feedback?.reason === "already_synced") {
      return `Kết quả: SAI — DB đã khớp${idxPart}${textPart}`;
    }
    if (feedback?.reason === "no_match") {
      return `Kết quả: SAI — không khớp đáp án trên trang${textPart}`;
    }
    if (feedback?.reason === "no_correct_text") {
      return "Kết quả: SAI — không đọc được đáp án đúng trên trang";
    }

    return `Kết quả: SAI${idxPart}${textPart}`;
  }

  async function showFeedbackResultPause(
    panel,
    feedback,
    onProgress,
    displayMs = FEEDBACK_RESULT_DISPLAY_MS
  ) {
    const total = Math.max(0, Number(displayMs) ?? FEEDBACK_RESULT_DISPLAY_MS);
    const baseMsg = formatPageFeedbackStatus(panel, feedback);

    if (onProgress) onProgress(baseMsg);
    if (total === 0) return;

    const end = Date.now() + total;
    while (Date.now() < end) {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (onProgress && left > 0) {
        onProgress(`${baseMsg} (${left}s)`);
      }
      await sleep(Math.min(250, end - Date.now()));
    }
  }

  async function upsertCorrectAnswerIfNeeded(panel, ctx, apiCorrectAnswerIndex) {
    const { questionTitle, rawQuestion, questionNorm, insertApiUrl, onProgress, panel: ctxPanel } =
      ctx;
    const resolved = await waitForCorrectAnswerIndexFromPanel(
      panel,
      ctx.correctAnswerResolveWaitMs ?? CORRECT_ANSWER_RESOLVE_WAIT_MS,
      onProgress
    );
    panel = resolved.panel || panel;
    const correctText =
      resolved.correctText || getCorrectAnswerTextFromPanel(panel);
    const answerPosition = resolved.index;

    if (answerPosition === null || answerPosition === undefined) {
      return {
        incorrect: true,
        corrected: false,
        correctText,
        reason: correctText ? "no_match" : "no_correct_text",
      };
    }

    const answers = getAnswerOptions(panel);
    const optionText = getAnswerOptionText(answers[answerPosition]);
    const rawApiIdx = ctx.apiCorrectAnswerIndex ?? apiCorrectAnswerIndex;
    const apiIdx =
      rawApiIdx === null || rawApiIdx === undefined ? null : Number(rawApiIdx);

    if (Number.isInteger(apiIdx) && apiIdx === answerPosition) {
      window.NCN_LOG?.log("flow", "DB index đã khớp đáp án đúng trên trang — không insert", {
        index: answerPosition,
        source: resolved.source,
      });
      return {
        incorrect: true,
        corrected: false,
        answerPosition,
        correctText: correctText || optionText,
        reason: "already_synced",
      };
    }

    if (onProgress) {
      onProgress(
        `DB index ${Number.isInteger(apiIdx) ? apiIdx : "?"} ≠ đúng index ${answerPosition} (${resolved.source}) → insert: ${(correctText || optionText).slice(0, 50)}`
      );
    }

    window.NCN_LOG?.log("flow", "Insert vì trang báo sai (DB ≠ đúng)", {
      dbIndex: apiIdx,
      correctIndex: answerPosition,
      matchSource: resolved.source,
      correctText: (correctText || optionText)?.slice(0, 80),
    });

    await insertAnswerToApi(
      {
        questionTitle,
        question: rawQuestion,
        questionNorm,
        panel: ctxPanel || panel,
        answerPosition,
      },
      insertApiUrl
    );

    return {
      incorrect: true,
      corrected: true,
      answerPosition,
      correctText: correctText || optionText,
      matchSource: resolved.source,
    };
  }

  /**
   * Sau khi chọn đáp án: nếu trang báo đáp án đúng khác DB → insert/upsert lên BE.
   */
  async function syncCorrectAnswerIfWrong(panelHint, ctx) {
    const { onProgress, feedbackWaitMs } = ctx;
    const waitMs = feedbackWaitMs ?? SYNC_FEEDBACK_WAIT_MS;

    const feedbackWait = await waitForAnswerFeedback(panelHint, waitMs, onProgress);
    let panel = feedbackWait.panel;
    const hasFeedback = feedbackWait.ok;

    if (!hasFeedback) {
      window.NCN_LOG?.log("page", "Chờ phản hồi trang — timeout (chưa thấy sai)", {
        waitMs,
      });
      const result = {
        incorrect: false,
        corrected: false,
        reason: "feedback_timeout",
        skipNote: `Trang chưa báo sai sau ${Math.round(waitMs / 1000)}s — không gọi /insert`,
      };
      await showFeedbackResultPause(panel, result, onProgress);
      return result;
    }

    if (!isPanelIncorrect(panel)) {
      window.NCN_LOG?.log("page", "Trang không báo sai — bỏ qua insert", {
        waitMs,
      });
      const result = {
        incorrect: false,
        corrected: false,
        reason: "page_ok",
        skipNote: "Trang không báo sai — coi như đúng, không /insert",
      };
      await showFeedbackResultPause(panel, result, onProgress);
      return result;
    }

    const previewResolved = findCorrectAnswerIndexFromPanel(panel);
    const previewText =
      previewResolved.correctText || getCorrectAnswerTextFromPanel(panel);
    const preview = {
      incorrect: true,
      corrected: false,
      correctText: previewText || null,
      answerPosition: previewResolved.index,
      matchSource: previewResolved.source,
    };
    await showFeedbackResultPause(panel, preview, onProgress);

    return upsertCorrectAnswerIfNeeded(
      panel,
      ctx,
      ctx.apiCorrectAnswerIndex ?? ctx.dbAnswerIndex
    );
  }

  /** Chuyển correctAnswerIndex API → index 0-based trong danh sách đáp án */
  function resolveAnswerIndex0(panel, correctAnswerIndex) {
    const idx = Number(correctAnswerIndex);
    const answers = getAnswerOptions(panel);

    if (!answers.length) {
      throw new Error(`Không thấy đáp án (${SELECTOR_ANSWER}).`);
    }

    if (idx >= 0 && idx < answers.length) return idx;
    if (idx >= 1 && idx <= answers.length) return idx - 1;

    const radioByValue = panel.querySelector(`input[type="radio"][value="${idx}"]`);
    if (radioByValue) {
      const box = radioByValue.closest(SELECTOR_ANSWER);
      const i = answers.indexOf(box);
      if (i >= 0) return i;
    }

    throw new Error(
      `Đáp án index ${idx} không hợp lệ (có ${answers.length} lựa chọn).`
    );
  }

  /**
   * Kiểm tra đáp án đang chọn: ưu tiên phản hồi trên trang, không có thì so với DB.
   */
  async function checkCurrentAnswer(apiUrl, options = {}) {
    const onProgress = options.onProgress;
    let panel = findActiveQuestionPanel();
    const answers = getAnswerOptions(panel);
    const selectedIdx = getSelectedAnswerIndex(panel);

    if (selectedIdx === null || selectedIdx === undefined) {
      throw new Error("Chưa chọn đáp án — hãy chọn một lựa chọn trước.");
    }

    const questionTitle = getQuestionTitle(panel);
    const rawQuestion = getQuestionText(panel);
    const selectedText = getAnswerOptionText(answers[selectedIdx]);

    if (onProgress) onProgress("Đang chờ phản hồi đúng/sai trên trang…");
    const feedbackWait = await waitForAnswerFeedback(
      panel,
      options.feedbackWaitMs ?? SYNC_FEEDBACK_WAIT_MS,
      onProgress
    );
    panel = feedbackWait.panel;

    if (isPanelIncorrect(panel)) {
      const resolved = await waitForCorrectAnswerIndexFromPanel(
        panel,
        options.correctAnswerResolveWaitMs ?? CORRECT_ANSWER_RESOLVE_WAIT_MS,
        onProgress
      );
      panel = resolved.panel || panel;
      const correctText =
        resolved.correctText || getCorrectAnswerTextFromPanel(panel);
      const correctIndex = resolved.index;
      const questionNorm = buildQuestionForApi(rawQuestion, panel);
      const insertApiUrl = options.insertApiUrl;
      let synced = false;
      let syncReason = null;

      if (insertApiUrl && correctIndex !== null && correctIndex !== undefined) {
        let apiCorrectAnswerIndex = null;
        try {
          const api = await fetchAnswerFromApi(questionTitle, questionNorm, apiUrl);
          if (api?.success && api.found && api.data) {
            apiCorrectAnswerIndex = resolveAnswerIndex0(
              panel,
              api.data.correctAnswerIndex
            );
          }
        } catch (err) {
          window.NCN_LOG?.log("flow", "Check: không đọc DB trước insert", {
            error: err?.message || String(err),
          });
        }

        try {
          const syncResult = await upsertCorrectAnswerIfNeeded(
            panel,
            {
              questionTitle,
              rawQuestion,
              questionNorm,
              panel,
              insertApiUrl,
              onProgress,
              apiCorrectAnswerIndex,
            },
            apiCorrectAnswerIndex
          );
          synced = syncResult.corrected === true;
          syncReason = syncResult.reason || null;
        } catch (err) {
          window.NCN_LOG?.log("flow", "Check: insert sau sai thất bại", {
            error: err?.message || String(err),
          });
        }
      }

      const result = {
        ok: true,
        correct: false,
        source: "page",
        selectedIndex: selectedIdx,
        selectedText,
        correctText: correctText || null,
        correctIndex,
        synced,
        syncReason,
        message: "",
      };
      result.message = formatCheckMessage(result);
      if (synced && onProgress) {
        onProgress(`Đã cập nhật BE: index ${correctIndex}`);
      }
      await showFeedbackResultPause(
        panel,
        {
          incorrect: true,
          correctText,
          answerPosition: correctIndex,
          reason: synced ? undefined : syncReason,
        },
        onProgress
      );
      return result;
    }

    if (onProgress) onProgress("So sánh đáp án đang chọn với DB…");
    const questionNorm = buildQuestionForApi(rawQuestion, panel);
    const api = await fetchAnswerFromApi(questionTitle, questionNorm, apiUrl);

    if (!api?.success) {
      throw new Error("API trả success=false");
    }
    if (!api.found || !api.data) {
      throw new Error("Chưa có đáp án trong DB — không thể kiểm tra.");
    }

    const dbIdx = resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
    const dbText = getAnswerOptionText(answers[dbIdx]);
    const correct = selectedIdx === dbIdx;
    const result = {
      ok: true,
      correct,
      source: "db",
      selectedIndex: selectedIdx,
      selectedText,
      dbIndex: dbIdx,
      correctText: correct ? selectedText : dbText,
      correctIndex: dbIdx,
      answerId: api.data.id ?? null,
      message: "",
    };
    result.message = formatCheckMessage(result);
    await showFeedbackResultPause(
      panel,
      correct
        ? { reason: "page_ok" }
        : {
            incorrect: true,
            correctText: dbText,
            answerPosition: dbIdx,
          },
      onProgress
    );
    return result;
  }

  function formatQuestionStatusMessage(status) {
    const lines = ["── Trạng thái câu ──"];

    if (status.selectedIndex !== null && status.selectedIndex !== undefined) {
      lines.push(
        `Đang chọn: [${status.selectedIndex}] ${status.selectedText || "?"}`
      );
    } else {
      lines.push("Đang chọn: (chưa chọn)");
    }

    if (status.pageReported === "incorrect") {
      lines.push(`Trang: SAI`);
      if (status.pageCorrectText) {
        lines.push(`  → Đúng: ${status.pageCorrectText}`);
      }
      if (status.pageCorrectIndex !== null && status.pageCorrectIndex !== undefined) {
        lines.push(`  → Index đúng: ${status.pageCorrectIndex}`);
      }
    } else if (status.pageReported === "correct") {
      lines.push("Trang: ĐÚNG (không báo sai)");
    } else {
      lines.push("Trang: chưa báo / chưa chọn để kiểm tra");
    }

    if (!status.inDb) {
      lines.push("DB: chưa có câu này");
    } else {
      lines.push(
        `DB: [${status.dbIndex}] ${status.dbText || "?"}${status.answerId ? ` (id ${status.answerId})` : ""}`
      );
    }

    lines.push(`Server: ${status.serverSyncLabel}`);

    const logBlock = window.NCN_LOG?.formatRecent(30) || "";
    return `${lines.join("\n")}\n\n${logBlock}`;
  }

  /**
   * Báo cáo trạng thái: đúng/sai trên trang, DB, đã khớp server khi sai chưa.
   */
  async function getQuestionStatus(apiUrl, options = {}) {
    const onProgress = options.onProgress;
    window.NCN_LOG?.log("status", "Bấm Trạng thái — bắt đầu kiểm tra");
    let panel = findActiveQuestionPanel();
    const answers = getAnswerOptions(panel);
    const questionTitle = getQuestionTitle(panel);
    const rawQuestion = getQuestionText(panel);
    const questionNorm = buildQuestionForApi(rawQuestion, panel);
    const selectedIdx = getSelectedAnswerIndex(panel);
    const selectedText =
      selectedIdx !== null && selectedIdx !== undefined
        ? getAnswerOptionText(answers[selectedIdx])
        : null;

    if (!isPanelIncorrect(panel) && selectedIdx !== null) {
      if (onProgress) onProgress("Chờ phản hồi trang…");
      const feedbackWait = await waitForAnswerFeedback(
        panel,
        options.feedbackWaitMs ?? SYNC_FEEDBACK_WAIT_MS,
        onProgress
      );
      panel = feedbackWait.panel;
    }

    const pageIncorrect = isPanelIncorrect(panel);
    let pageCorrectText = null;
    let pageCorrectIndex = null;
    let pageReported = "unknown";

    if (pageIncorrect) {
      pageReported = "incorrect";
      const resolved = findCorrectAnswerIndexFromPanel(panel);
      pageCorrectText =
        resolved.correctText || getCorrectAnswerTextFromPanel(panel);
      pageCorrectIndex = resolved.index;
    } else if (isPanelCorrect(panel)) {
      pageReported = "correct";
    } else if (selectedIdx !== null && !pageIncorrect) {
      pageReported = "unknown";
    }

    if (onProgress) onProgress("Đang hỏi DB…");
    let inDb = false;
    let dbIndex = null;
    let dbText = null;
    let answerId = null;
    let apiError = null;

    try {
      const api = await fetchAnswerFromApi(questionTitle, questionNorm, apiUrl);
      if (api?.success && api.found && api.data) {
        inDb = true;
        dbIndex = resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
        dbText = getAnswerOptionText(answers[dbIndex]);
        answerId = api.data.id ?? null;
      }
    } catch (err) {
      apiError = err?.message || String(err);
    }

    let serverSync = "unknown";
    let serverSyncLabel = "—";

    if (pageReported === "incorrect") {
      if (pageCorrectIndex === null || pageCorrectIndex === undefined) {
        serverSync = "unmatched_label";
        serverSyncLabel = "Không khớp text đáp án trên trang";
      } else if (!inDb) {
        serverSync = "needs_insert";
        serverSyncLabel = `Chưa có DB — cần insert index ${pageCorrectIndex}`;
      } else if (dbIndex === pageCorrectIndex) {
        serverSync = "synced";
        serverSyncLabel = "Đã có trên server (DB = đáp án đúng)";
      } else {
        serverSync = "needs_insert";
        serverSyncLabel = `Chưa khớp — DB [${dbIndex}] ≠ đúng [${pageCorrectIndex}] → cần insert`;
      }
    } else if (pageReported === "correct" && selectedIdx !== null) {
      if (!inDb) {
        serverSync = "no_db";
        serverSyncLabel = "Chưa có trong DB (có thể insert nếu cần)";
      } else if (dbIndex === selectedIdx) {
        serverSync = "synced";
        serverSyncLabel = "OK — DB khớp đáp án đang chọn";
      } else {
        serverSync = "db_mismatch";
        serverSyncLabel = `DB [${dbIndex}] ≠ đang chọn [${selectedIdx}]`;
      }
    } else if (selectedIdx !== null && inDb) {
      const match = selectedIdx === dbIndex;
      serverSync = match ? "synced" : "db_mismatch";
      serverSyncLabel = match
        ? "Theo DB: đang chọn = DB"
        : `Theo DB: đang chọn [${selectedIdx}] ≠ DB [${dbIndex}]`;
    } else if (!inDb) {
      serverSync = "no_db";
      serverSyncLabel = "Chưa có trong DB";
    } else {
      serverSyncLabel = "Chọn đáp án rồi bấm lại";
    }

    if (apiError) {
      serverSyncLabel += ` (lỗi API: ${apiError.slice(0, 60)})`;
    }

    const result = {
      ok: true,
      questionTitle,
      selectedIndex: selectedIdx,
      selectedText,
      pageReported,
      pageIncorrect,
      pageCorrectText,
      pageCorrectIndex,
      inDb,
      dbIndex,
      dbText,
      answerId,
      serverSync,
      serverSyncLabel,
      message: "",
    };
    result.message = formatQuestionStatusMessage(result);
    window.NCN_LOG?.log("status", "Kết quả trạng thái", {
      page: result.pageReported,
      serverSync: result.serverSync,
      inDb: result.inDb,
      dbIndex: result.dbIndex,
      pageCorrectIndex: result.pageCorrectIndex,
    });
    return result;
  }

  function formatInsertResponseMessage(result) {
    const resp = result.insertResponse;
    let beNote = "";
    if (resp && typeof resp === "object") {
      const parts = [];
      if (resp.created !== undefined) parts.push(`created=${resp.created}`);
      if (resp.updated !== undefined) parts.push(`updated=${resp.updated}`);
      if (resp.action) parts.push(`action=${resp.action}`);
      if (resp.message) parts.push(String(resp.message));
      if (parts.length) beNote = ` — BE: ${parts.join(", ")}`;
      else beNote = ` — BE: ${JSON.stringify(resp).slice(0, 120)}`;
    }
    const src =
      result.source === "page"
        ? "đáp án đúng từ trang (sai)"
        : "đáp án đang chọn";
    const textPart = result.correctText
      ? `: ${result.correctText.slice(0, 60)}`
      : "";
    return `Đã gửi /insert index ${result.answerPosition} (${src})${textPart}${beNote}`;
  }

  /**
   * Gửi đáp án lên /insert — ưu tiên đáp án đúng khi trang báo sai.
   */
  /** Test bấm Tiếp — cùng delay + XPath như luồng auto. */
  async function testClickNext(options = {}) {
    const nextDelayMinMs = options.nextDelayMinMs ?? 1_000;
    const nextDelayMaxMs = options.nextDelayMaxMs ?? 1_000;
    const skipDelay = options.skipDelay === true;
    const onProgress = options.onProgress;

    const nextDelayMs = skipDelay
      ? 0
      : randomDelayMs(nextDelayMinMs, nextDelayMaxMs);

    if (nextDelayMs > 0) {
      if (onProgress) {
        onProgress(
          `Chờ ngẫu nhiên ${Math.round(nextDelayMinMs / 1000)}–${Math.round(nextDelayMaxMs / 1000)}s rồi bấm Tiếp (như auto)…`
        );
      }
      await waitWithCountdown(nextDelayMs, onProgress, "Bấm Tiếp");
    }

    if (onProgress) onProgress("Đang bấm Tiếp…");
    const nextClick = clickNextButton();

    const tag = nextClick?.tag || "?";
    const text = nextClick?.text ? ` — ${nextClick.text}` : "";
    return {
      ok: true,
      nextXPath: XPATH_NEXT,
      nextDelayMs,
      nextClick,
      message: `OK — đã bấm Tiếp <${tag}>${text}`,
    };
  }

  async function insertCurrentAnswer(insertApiUrl, options = {}) {
    const onProgress = options.onProgress;
    const skipFeedbackWait = options.skipFeedbackWait === true;
    let panel = findActiveQuestionPanel();
    const questionTitle = getQuestionTitle(panel);
    const rawQuestion = getQuestionText(panel);
    const answers = getAnswerOptions(panel);

    if (!skipFeedbackWait && !isPanelIncorrect(panel)) {
      if (onProgress) onProgress("Chờ trang báo đúng/sai…");
      const feedbackWait = await waitForAnswerFeedback(
        panel,
        options.feedbackWaitMs ?? SYNC_FEEDBACK_WAIT_MS,
        onProgress
      );
      panel = feedbackWait.panel;
    }

    let answerPosition = null;
    let correctText = null;
    let source = null;

    if (isPanelIncorrect(panel)) {
      const resolveWaitMs =
        options.correctAnswerResolveWaitMs ??
        (skipFeedbackWait ? 3_000 : CORRECT_ANSWER_RESOLVE_WAIT_MS);
      let resolved = findCorrectAnswerIndexFromPanel(panel);
      if (
        skipFeedbackWait &&
        (resolved.index === null || resolved.index === undefined)
      ) {
        if (onProgress) onProgress("Đọc đáp án đúng trên trang…");
        resolved = await waitForCorrectAnswerIndexFromPanel(
          panel,
          resolveWaitMs,
          onProgress
        );
      } else if (!skipFeedbackWait) {
        resolved = await waitForCorrectAnswerIndexFromPanel(
          panel,
          resolveWaitMs,
          onProgress
        );
      }
      panel = resolved.panel || panel;
      correctText =
        resolved.correctText || getCorrectAnswerTextFromPanel(panel);
      if (!correctText && resolved.index === null) {
        throw new Error("Trang báo sai nhưng không đọc được đáp án đúng.");
      }
      answerPosition = resolved.index;
      if (answerPosition === null || answerPosition === undefined) {
        throw new Error(
          `Không khớp đáp án trên trang: "${(correctText || "").slice(0, 80)}"`
        );
      }
      source = resolved.source || "page";
    } else {
      const selectedIdx = getSelectedAnswerIndex(panel);
      if (selectedIdx === null || selectedIdx === undefined) {
        throw new Error(
          "Trang chưa báo sai và chưa chọn đáp án — chọn sai trước hoặc chọn một đáp án."
        );
      }
      answerPosition = selectedIdx;
      correctText = getAnswerOptionText(answers[selectedIdx]);
      source = "selected";
    }

    if (onProgress) {
      onProgress(
        `Gửi /insert index ${answerPosition}: ${(correctText || "").slice(0, 50)}…`
      );
    }

    const insertResponse = await insertAnswerToApi(
      {
        questionTitle,
        question: rawQuestion,
        questionNorm: buildQuestionForApi(rawQuestion, panel),
        panel,
        answerPosition,
      },
      insertApiUrl
    );

    const result = {
      ok: true,
      source,
      answerPosition,
      correctText,
      questionTitle,
      question: buildQuestionForApi(rawQuestion, panel),
      insertResponse,
      message: "",
    };
    const pageVerdict = getPanelAnswerVerdict(panel);
    result.pageVerdict = pageVerdict;
    result.message = formatInsertResponseMessage(result);
    if (skipFeedbackWait) {
      const tag =
        pageVerdict === "incorrect"
          ? "SAI"
          : pageVerdict === "correct"
            ? "ĐÚNG"
            : "—";
      result.message = `${tag} — ${result.message}`;
    }
    return result;
  }

  /**
   * Đọc kết quả trên trang (sau khi bạn tự chọn đáp án) → POST /insert.
   * Không click, không chờ feedback dài.
   */
  async function pushPageResultToServer(insertApiUrl, options = {}) {
    return insertCurrentAnswer(insertApiUrl, {
      ...options,
      skipFeedbackWait: true,
      feedbackWaitMs: 0,
      correctAnswerResolveWaitMs: options.correctAnswerResolveWaitMs ?? 3_000,
    });
  }

  async function runAutoAnswer(apiUrl, options = {}) {
    const pickOnly = options.pickOnly === true;
    const answerDelayMinMs = pickOnly
      ? 0
      : (options.answerDelayMinMs ?? DEFAULT_ANSWER_DELAY_MIN_MS);
    const answerDelayMaxMs = pickOnly
      ? 0
      : (options.answerDelayMaxMs ?? DEFAULT_ANSWER_DELAY_MAX_MS);
    const nextDelayMinMs = options.nextDelayMinMs ?? 1_000;
    const nextDelayMaxMs = options.nextDelayMaxMs ?? 1_000;
    const autoClickNext = pickOnly ? false : options.autoClickNext !== false;
    const autoPickFirstOnNotFound = pickOnly
      ? false
      : options.autoPickFirstOnNotFound !== false;
    const defaultAnswerPosition = options.defaultAnswerPosition ?? 0;
    const insertApiUrl = options.insertApiUrl;
    const onProgress = options.onProgress;

    const panel = findActiveQuestionPanel();
    const questionTitle = getQuestionTitle(panel);
    const rawQuestion = getQuestionText(panel);
    const questionNorm = buildQuestionForApi(rawQuestion, panel);

    window.NCN_LOG?.log("flow", pickOnly ? "Chọn (kiểm tra) 1 câu" : "Trả lời 1 câu — bắt đầu", {
      questionTitle: questionTitle?.slice(0, 60),
      question: questionNorm.slice(0, 100),
      imageKeys: getQuestionImageKeys(panel),
    });

    if (onProgress) {
      onProgress(
        pickOnly
          ? "Kiểm tra: đọc câu hỏi → gọi BE → chọn đáp án"
          : "Đọc câu hỏi → gọi BE…"
      );
    }

    const api = await fetchAnswerFromApi(questionTitle, questionNorm, apiUrl);

    if (!api?.success) {
      throw new Error("API trả success=false");
    }

    const answers = getAnswerOptions(panel);
    let answerIdx = 0;
    let answerPosition = defaultAnswerPosition;
    let answerId = null;
    let insertedToDb = false;
    let usedFallback = false;

    if (!api.found || !api.data) {
      if (!autoPickFirstOnNotFound) {
        if (pickOnly) {
          await alertQuestionNotFound(options);
          const err = new Error(
            "Chưa có trong DB — chế độ kiểm tra không tự chọn."
          );
          err.code = "QUESTION_NOT_FOUND";
          throw err;
        }
        await alertQuestionNotFound(options);
        const err = new Error("Không tìm thấy đáp án trong DB — đã kêu chuông.");
        err.code = "QUESTION_NOT_FOUND";
        throw err;
      }

      await alertQuestionNotFound(options);
      usedFallback = true;
      answerIdx = Math.min(
        Math.max(0, defaultAnswerPosition),
        Math.max(0, answers.length - 1)
      );
      answerPosition = answerIdx;

      if (onProgress) {
        onProgress(`Chưa có trong DB → chọn index ${answerPosition} + gửi insert`);
      }
    } else {
      const { correctAnswerIndex, id } = api.data;
      answerId = id;
      answerIdx = resolveAnswerIndex0(panel, correctAnswerIndex);
      answerPosition = answerIdx;
    }

    const answerEl = resolveAnswerElement(panel, answerIdx);
    const answerXPath = buildAnswerXPath(panel, answerIdx);

    const answerDelayMs = pickOnly
      ? 0
      : computeAnswerDelayMs({
          answerDelayMinMs,
          answerDelayMaxMs,
        });
    if (answerDelayMs > 0) {
      if (onProgress) {
        onProgress(
          `Chờ ngẫu nhiên ${Math.round(answerDelayMinMs / 1000)}–${Math.round(answerDelayMaxMs / 1000)}s (≈${Math.round(answerDelayMs / 1000)}s) rồi chọn đáp án`
        );
      }
      await waitWithCountdown(answerDelayMs, onProgress, "Chọn đáp án");
    }

    if (onProgress) onProgress("Đang chọn đáp án…");
    const clickResult = clickAnswerElement(answerEl, answerXPath);
    window.NCN_LOG?.log("page", "Đã chọn đáp án", {
      index: answerPosition,
      usedFallback,
      answerId,
    });

    let feedback = { incorrect: false, corrected: false };
    try {
      feedback = await syncCorrectAnswerIfWrong(panel, {
        questionTitle,
        rawQuestion,
        questionNorm,
        panel,
        insertApiUrl,
        onProgress,
        feedbackWaitMs: options.syncFeedbackWaitMs ?? SYNC_FEEDBACK_WAIT_MS,
        correctAnswerResolveWaitMs:
          options.correctAnswerResolveWaitMs ?? CORRECT_ANSWER_RESOLVE_WAIT_MS,
        apiCorrectAnswerIndex: answerIdx,
        dbAnswerIndex: answerIdx,
      });
      window.NCN_LOG?.log("page", "Kết quả sau chọn (trang/DB)", {
        ...feedback,
        pickOnly,
        pageIncorrectNow: isPanelIncorrect(findAnsweredQuestionPanel(panel)),
      });
    } catch (err) {
      console.warn("[NCN] Kiểm tra / insert sau khi sai:", err);
      if (onProgress) onProgress(`Sai/insert lỗi: ${err.message} — vẫn tiếp tục`);
      feedback = { incorrect: true, corrected: false, error: err.message };
    }

    if (pickOnly) {
      if (onProgress) {
        onProgress(
          feedback.corrected
            ? `Kiểm tra: đã chọn index ${answerPosition} → cập nhật BE index ${feedback.answerPosition}`
            : feedback.incorrect && !feedback.corrected
              ? `Kiểm tra: đã chọn index ${answerPosition} — trang báo sai${feedback.reason ? ` (${feedback.reason})` : ""}`
              : `Kiểm tra: đã chọn index ${answerPosition}`
        );
      }
    }

    if (feedback.corrected) {
      answerPosition = feedback.answerPosition;
      answerIdx = answerPosition;
      insertedToDb = true;
      if (onProgress) onProgress(`Đã cập nhật BE: index ${answerPosition}`);
    } else if (
      !pickOnly &&
      usedFallback &&
      !insertedToDb &&
      !isPanelIncorrect(panel)
    ) {
      try {
        if (onProgress) onProgress("Chưa có DB, chọn đúng → gửi /api/insert…");
        await insertAnswerToApi(
          {
            questionTitle,
            question: rawQuestion,
            questionNorm,
            panel,
            answerPosition,
          },
          insertApiUrl
        );
        insertedToDb = true;
        window.NCN_LOG?.log("flow", "Insert sau khi chọn đúng (câu mới DB)", {
          index: answerPosition,
        });
        if (onProgress) onProgress(`Đã insert index ${answerPosition} lên BE`);
      } catch (err) {
        console.warn("[NCN] Insert thất bại:", err);
        if (onProgress) onProgress(`Insert lỗi: ${err.message} — vẫn tiếp tục`);
      }
    } else if (feedback.incorrect && !feedback.corrected) {
      if (onProgress) {
        onProgress(
          feedback.correctText
            ? `Sai nhưng chưa cập nhật BE: "${feedback.correctText.slice(0, 60)}"${feedback.reason ? ` (${feedback.reason})` : ""}`
            : `Sai nhưng không đọc được đáp án đúng trên trang${feedback.reason ? ` (${feedback.reason})` : ""}`
        );
      }
    } else if (feedback.reason === "feedback_timeout") {
      if (onProgress) {
        onProgress(
          feedback.skipNote ||
            "Trang chưa kịp báo sai — không insert (tăng thời gian chờ nếu cần)"
        );
      }
    } else if (feedback.reason === "page_ok") {
      window.NCN_LOG?.log("flow", feedback.skipNote || "Trang OK — không insert");
    }

    let nextDelayMs = 0;
    let nextClick = null;
    if (autoClickNext) {
      nextDelayMs = randomDelayMs(nextDelayMinMs, nextDelayMaxMs);
      if (onProgress) {
        onProgress(
          `Đã chọn. Chờ ngẫu nhiên ${Math.round(nextDelayMinMs / 1000)}–${Math.round(nextDelayMaxMs / 1000)}s rồi bấm Tiếp`
        );
      }
      await waitWithCountdown(nextDelayMs, onProgress, "Bấm Tiếp");
      if (onProgress) onProgress("Đang bấm Tiếp…");
      nextClick = clickNextButton();
      window.NCN_LOG?.log("page", "Đã bấm Tiếp", { delayMs: nextDelayMs });
    }

    window.NCN_LOG?.log("flow", "Hoàn tất 1 câu", {
      index: answerPosition,
      insertedToDb,
      wasIncorrect: feedback.incorrect,
      correctedInDb: feedback.corrected,
    });

    return {
      ok: true,
      question: questionNorm,
      questionTitle,
      questionXPath: buildQuestionXPath(panel),
      panelPosition: getPanelPosition(panel),
      correctAnswerIndex: answerIdx,
      answerPosition,
      answerId,
      answerCount: answers.length,
      answerXPath,
      nextXPath: XPATH_NEXT,
      answerDelayMs,
      nextDelayMs,
      pickOnly,
      usedFallback,
      insertedToDb,
      wasIncorrect: feedback.incorrect,
      correctedInDb: feedback.corrected,
      correctAnswerText: feedback.correctText || null,
      click: clickResult,
      nextClick,
    };
  }

  async function invokeAutoClickServer(x, y, clickApiUrl) {
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

  function getAnswerCoordinatesAtIndex(panel, index0, options = {}) {
    const answerEl = resolveAnswerElement(panel, index0);
    const serverClick = options.serverClick === true;
    const coords = getElementClickCoordinates(answerEl, {
      randomize: options.randomize !== false,
      serverClick,
      skipScroll: serverClick,
      requireInViewport: options.requireInViewport !== false,
    });
    const answers = getAnswerOptions(panel);
    return {
      index: index0,
      coords,
      answerText: getAnswerOptionText(answers[index0]),
    };
  }

  function pickRandomAnswerIndex(answerCount) {
    const n = Math.max(0, Number(answerCount) || 0);
    if (n <= 0) return 0;
    return Math.floor(Math.random() * n);
  }

  function isAnswerClickAcknowledged(panelHint, expectedIndex) {
    const panel = findAnsweredQuestionPanel(panelHint);
    if (!panel?.isConnected) return false;

    const selected = getSelectedAnswerIndex(panel);
    if (selected === expectedIndex) return true;
    if (hasAnswerFeedback(panel)) return true;

    const verdict = getPanelAnswerVerdict(panel);
    return verdict === "correct" || verdict === "incorrect";
  }

  async function waitForServerClickAck(checkFn, ackWaitMs, pollMs = CLICK_ACK_POLL_MS) {
    const total = Math.max(pollMs, Number(ackWaitMs) || CLICK_ACK_WAIT_MS);
    const start = Date.now();
    while (Date.now() - start < total) {
      if (checkFn()) return true;
      await sleep(pollMs);
    }
    return checkFn();
  }

  async function serverClickAnswerWithRetry(
    panel,
    pickIndex,
    clickApiUrl,
    onProgress,
    options = {}
  ) {
    const maxAttempts = Math.max(1, Number(options.clickRetryMax) || 2);
    const ackWaitMs = Math.max(
      CLICK_ACK_POLL_MS,
      Number(options.clickAckWaitMs) || CLICK_ACK_WAIT_MS
    );
    let lastClick = null;
    let lastCoords = null;

    let totalAttempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const answerCoords = getAnswerCoordinatesAtIndex(panel, pickIndex, {
        randomize: true,
        serverClick: true,
      });

      if (onProgress) {
        onProgress(
          attempt > 1
            ? `Click đáp án lần ${attempt}/${maxAttempts} (index ${pickIndex})…`
            : `Click index ${pickIndex}…`
        );
      }

      lastClick = await invokeAutoClickServer(
        answerCoords.coords.screenX,
        answerCoords.coords.screenY,
        clickApiUrl
      );
      lastCoords = answerCoords.coords;

      const acked = await waitForServerClickAck(
        () => isAnswerClickAcknowledged(panel, pickIndex),
        ackWaitMs
      );
      if (acked) {
        totalAttempts = attempt;
        return { clickData: lastClick, coords: lastCoords, attempts: totalAttempts };
      }

      if (onProgress) {
        onProgress(`Chưa ăn click — lấy tọa độ lại (${attempt}/${maxAttempts})…`);
      }
      await sleep(CLICK_RETRY_PAUSE_MS);
    }
    totalAttempts = maxAttempts;

    // Fallback 1: click giữa (center)
    if (onProgress) onProgress(`Random không ăn — click giữa đáp án…`);
    const centerCoords = getAnswerCoordinatesAtIndex(panel, pickIndex, {
      randomize: false,
      serverClick: true,
    });
    lastClick = await invokeAutoClickServer(
      centerCoords.coords.screenX,
      centerCoords.coords.screenY,
      clickApiUrl
    );
    lastCoords = centerCoords.coords;
    totalAttempts++;
    let acked = await waitForServerClickAck(
      () => isAnswerClickAcknowledged(panel, pickIndex),
      ackWaitMs
    );
    if (acked) {
      return { clickData: lastClick, coords: lastCoords, attempts: totalAttempts };
    }

    // Fallback 2: click đầu (mép trái của vùng click)
    await sleep(CLICK_RETRY_PAUSE_MS);
    if (onProgress) onProgress(`Giữa không ăn — click đầu đáp án…`);
    const answerEl = resolveAnswerElement(panel, pickIndex);
    const container = answerEl.closest?.(SELECTOR_ANSWER) || answerEl;
    const rect = container.getBoundingClientRect();
    const zone = getAnswerClickZone(container, rect);
    const startPoint = clampClientPointToRect(
      zone.xMin + 4,
      (zone.top + zone.bottom) / 2,
      rect
    );
    const startScreen = clientToScreen(startPoint.clientX, startPoint.clientY);
    lastClick = await invokeAutoClickServer(startScreen.screenX, startScreen.screenY, clickApiUrl);
    lastCoords = startScreen;
    totalAttempts++;
    acked = await waitForServerClickAck(
      () => isAnswerClickAcknowledged(panel, pickIndex),
      ackWaitMs
    );
    if (acked) {
      return { clickData: lastClick, coords: lastCoords, attempts: totalAttempts };
    }

    throw new Error(
      `Click đáp án không ăn sau ${totalAttempts} lần — kiểm tra server click / phần tử trong viewport.`
    );
  }

  function getQuestionNormFromPanel(panel) {
    const raw = getQuestionText(panel);
    return buildQuestionForApi(raw, panel);
  }

  async function serverClickNextWithRetry(
    questionNormBefore,
    clickApiUrl,
    onProgress,
    options = {}
  ) {
    const maxAttempts = Math.max(1, Number(options.nextRetryMax) || 4);
    const ackWaitMs = Math.max(
      CLICK_ACK_POLL_MS,
      Number(options.nextAckWaitMs) || NEXT_ACK_WAIT_MS
    );
    let lastClick = null;
    let lastCoords = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const nextCoords = getNextButtonClickCoordinates({
        randomize: true,
        serverClick: true,
      });

      if (onProgress) {
        onProgress(
          attempt > 1
            ? `Click Tiếp lần ${attempt}/${maxAttempts}…`
            : "Click Tiếp (server)…"
        );
      }

      lastClick = await invokeAutoClickServer(
        nextCoords.coords.screenX,
        nextCoords.coords.screenY,
        clickApiUrl
      );
      lastCoords = nextCoords.coords;

      const acked = await waitForServerClickAck(
        () => {
          try {
            const panel = findActiveQuestionPanel();
            const cur = getQuestionNormFromPanel(panel);
            return Boolean(cur && cur !== questionNormBefore);
          } catch {
            return false;
          }
        },
        ackWaitMs
      );
      if (acked) {
        return { clickData: lastClick, coords: lastCoords, attempts: attempt };
      }

      if (onProgress) {
        onProgress(`Chưa sang câu mới — click Tiếp lại (${attempt}/${maxAttempts})…`);
      }
      await sleep(NEXT_RETRY_PAUSE_MS);
    }

    throw new Error(`Click Tiếp không đổi câu sau ${maxAttempts} lần.`);
  }

  async function insertAfterServerAnswer(panel, ctx, options = {}) {
    const { usedFallback, intentionalWrong, insertApiUrl, onProgress } = ctx;
    if (!insertApiUrl || intentionalWrong) {
      return { inserted: false, skipped: true };
    }

    if (!usedFallback) {
      return { inserted: false, skipped: true };
    }

    if (onProgress) onProgress("Chờ kết quả đúng/sai trên trang…");
    const feedbackWait = await waitForAnswerFeedback(
      panel,
      options.feedbackWaitMs ?? SYNC_FEEDBACK_WAIT_MS,
      onProgress
    );
    panel = feedbackWait.panel;

    if (!feedbackWait.ok) {
      if (onProgress) onProgress("Chưa thấy đúng/sai — bỏ qua insert");
      return { inserted: false, reason: "no_feedback" };
    }

    try {
      if (onProgress) onProgress("Gửi /insert (câu chưa có DB)…");
      const ins = await pushPageResultToServer(insertApiUrl, {
        skipFeedbackWait: true,
        onProgress,
        correctAnswerResolveWaitMs:
          options.correctAnswerResolveWaitMs ?? CORRECT_ANSWER_RESOLVE_WAIT_MS,
      });
      return { inserted: true, insertResult: ins };
    } catch (err) {
      window.NCN_LOG?.log("flow", "Insert sau server click", {
        error: err?.message || String(err),
      });
      if (onProgress) onProgress(`Insert lỗi: ${err.message}`);
      return { inserted: false, error: err.message };
    }
  }

  function planPickIndex(panel, correctIndex, options = {}) {
    const answers = getAnswerOptions(panel);
    const n = answers.length;
    if (!n) {
      throw new Error(`Không thấy đáp án (${SELECTOR_ANSWER}).`);
    }

    const rate = Math.max(
      0,
      Math.min(1, Number(options.intentionalWrongRate) ?? 0.05)
    );
    const canPickWrong =
      options.allowIntentionalWrong !== false &&
      n > 1 &&
      correctIndex !== null &&
      correctIndex !== undefined &&
      Math.random() < rate;

    if (canPickWrong) {
      const pool = [];
      for (let i = 0; i < n; i++) {
        if (i !== correctIndex) pool.push(i);
      }
      if (pool.length) {
        const pickIndex = pool[Math.floor(Math.random() * pool.length)];
        return { pickIndex, correctIndex, intentionalWrong: true };
      }
    }

    const pickIndex =
      correctIndex !== null && correctIndex !== undefined
        ? correctIndex
        : Math.min(
            Math.max(0, options.defaultAnswerPosition ?? 0),
            n - 1
          );

    return { pickIndex, correctIndex, intentionalWrong: false };
  }

  /**
   * Một câu: BE → (đôi khi chọn sai) → delay → server click đáp án → delay → server click Tiếp.
   * Không click DOM trên LMS.
   */
  async function runOneQuestionViaServerClick(apiUrl, clickApiUrl, options = {}) {
    const onProgress = options.onProgress;
    const panel = findActiveQuestionPanel();
    const questionTitle = getQuestionTitle(panel);
    const rawQuestion = getQuestionText(panel);
    const questionNorm = buildQuestionForApi(rawQuestion, panel);
    const answers = getAnswerOptions(panel);

    if (onProgress) onProgress("Đọc câu → BE…");
    const api = await fetchAnswerFromApi(questionTitle, questionNorm, apiUrl);

    if (!api?.success) {
      throw new Error("API trả success=false");
    }

    let correctIndex = 0;
    let usedFallback = false;

    if (!api.found || !api.data) {
      if (options.alertOnNotFound !== false) {
        await alertQuestionNotFound(options);
      }
      correctIndex = pickRandomAnswerIndex(answers.length);
      usedFallback = true;
    } else {
      correctIndex = resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
    }

    const plan = planPickIndex(panel, correctIndex, {
      ...options,
      allowIntentionalWrong: usedFallback ? false : options.allowIntentionalWrong,
    });

    const answerDelayMs = computeAnswerDelayMs({
      answerDelayMinMs: options.answerDelayMinMs,
      answerDelayMaxMs: options.answerDelayMaxMs,
    });

    if (answerDelayMs > 0) {
      const label = plan.intentionalWrong
        ? "Chờ (có thể chọn sai)"
        : usedFallback
          ? "Chờ (chưa có DB — chọn đại)"
          : "Chờ";
      await waitWithCountdown(answerDelayMs, onProgress, label);
    }

    const answerResult = await serverClickAnswerWithRetry(
      panel,
      plan.pickIndex,
      clickApiUrl,
      onProgress,
      options
    );

    const insertOutcome = await insertAfterServerAnswer(
      panel,
      {
        usedFallback,
        intentionalWrong: plan.intentionalWrong,
        insertApiUrl: options.insertApiUrl,
        onProgress,
      },
      options
    );

    const nextDelayMs = randomDelayMs(
      options.serverNextDelayMinMs ?? 2_000,
      options.serverNextDelayMaxMs ?? 5_000
    );
    await waitWithCountdown(nextDelayMs, onProgress, "Chờ → Tiếp");

    const nextResult = await serverClickNextWithRetry(
      questionNorm,
      clickApiUrl,
      onProgress,
      options
    );

    window.NCN_LOG?.log("flow", "Server click 1 câu", {
      pick: plan.pickIndex,
      correct: plan.correctIndex,
      intentionalWrong: plan.intentionalWrong,
      usedFallback,
      inserted: insertOutcome.inserted,
      answerAttempts: answerResult.attempts,
      nextAttempts: nextResult.attempts,
    });

    return {
      ok: true,
      question: questionNorm,
      questionTitle,
      pickIndex: plan.pickIndex,
      correctIndex: plan.correctIndex,
      intentionalWrong: plan.intentionalWrong,
      usedFallback,
      answerDelayMs,
      nextDelayMs,
      answerClick: answerResult.clickData,
      nextClick: nextResult.clickData,
      answerCoords: answerResult.coords,
      nextCoords: nextResult.coords,
      answerClickAttempts: answerResult.attempts,
      nextClickAttempts: nextResult.attempts,
      insertedToDb: insertOutcome.inserted === true,
      insertResult: insertOutcome.insertResult || null,
    };
  }

  /**
   * Chỉ đọc câu hỏi trên trang → gọi /answer → trả index (0-based).
   * Không click radio, không bấm Tiếp, không insert.
   */
  async function lookupAnswerIndex(apiUrl, options = {}) {
    const onProgress = options.onProgress;
    const panel = findActiveQuestionPanel();
    const questionTitle = getQuestionTitle(panel);
    const rawQuestion = getQuestionText(panel);
    const questionNorm = buildQuestionForApi(rawQuestion, panel);
    const answers = getAnswerOptions(panel);

    window.NCN_LOG?.log("flow", "Tra index — chỉ đọc + API", {
      questionTitle: questionTitle?.slice(0, 60),
      question: questionNorm.slice(0, 100),
    });

    if (onProgress) onProgress("Đọc câu hỏi → gọi BE…");

    const api = await fetchAnswerFromApi(questionTitle, questionNorm, apiUrl);

    if (!api?.success) {
      throw new Error("API trả success=false");
    }

    if (!api.found || !api.data) {
      if (options.alertOnNotFound !== false) {
        await alertQuestionNotFound(options);
      }
      const err = new Error("Chưa có trong DB.");
      err.code = "QUESTION_NOT_FOUND";
      throw err;
    }

    const answerIdx = resolveAnswerIndex0(panel, api.data.correctAnswerIndex);
    const answerText = getAnswerOptionText(answers[answerIdx]);
    const preview = answerText
      ? answerText.slice(0, 72) + (answerText.length > 72 ? "…" : "")
      : "";

    return {
      ok: true,
      question: questionNorm,
      questionTitle,
      rawQuestion,
      answerPosition: answerIdx,
      answerId: api.data.id ?? null,
      answerText,
      answerCount: answers.length,
      message: preview
        ? `Index: ${answerIdx} (${answerIdx + 1}/${answers.length})\n${preview}`
        : `Index: ${answerIdx} (${answerIdx + 1}/${answers.length})`,
    };
  }

  window.NCN_AUTO_ANSWER = {
    normalizeQuestion,
    buildQuestionForApi,
    getQuestionImageKeys,
    computeAnswerDelayMs,
    computeReadingDelayMs,
    getQuestionPanels,
    getPanelPosition,
    findActiveQuestionPanel,
    getQuestionTitle,
    getQuestionText,
    getAnswerOptions,
    getSelectedAnswerIndex,
    checkCurrentAnswer,
    getQuestionStatus,
    formatQuestionStatusMessage,
    insertCurrentAnswer,
    pushPageResultToServer,
    testClickNext,
    formatCheckMessage,
    formatInsertResponseMessage,
    resolveAnswerElement,
    resolveAnswerIndex0,
    clickAnswerElement,
    clickNextButton,
    getNextButtonClickCoordinates,
    insertAnswerToApi,
    isPanelIncorrect,
    getPanelAnswerVerdict,
    findAnsweredQuestionPanel,
    getCorrectAnswerTextFromPanel,
    findAnswerPositionByLabel,
    findCorrectAnswerIndexFromPanel,
    syncCorrectAnswerIfWrong,
    buildQuestionXPath,
    buildAnswerXPath,
    xpathForElement,
    SYNC_FEEDBACK_WAIT_MS,
    CORRECT_ANSWER_RESOLVE_WAIT_MS,
    DEFAULT_FEEDBACK_WAIT_MS,
    XPATH_QUESTION,
    XPATH_ANSWER_GLOBAL,
    XPATH_NEXT,
    XPATH_KET_THUC_LUYEN_THI,
    getKetThucLuyenThiClickCoordinates,
    serverClickKetThucLuyenThi,
    runAutoAnswer,
    lookupAnswerIndex,
    fetchAnswerFromApi,
    getElementClickCoordinates,
    getCorrectAnswerCoordinates,
    getAnswerCoordinatesAtIndex,
    runOneQuestionViaServerClick,
    serverClickAnswerWithRetry,
    serverClickNextWithRetry,
    isAnswerClickAcknowledged,
    planPickIndex,
    pickRandomAnswerIndex,
    formatCoordsMessage,
    findCorrectAnswerIndexFromPanel,
  };
})();
