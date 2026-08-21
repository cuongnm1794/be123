/**
 * Mô phỏng tình huống giao thông — chỉ đọc DOM, không click/script trên trang.
 * Mọi click dùng server auto-py.
 */
(function () {
  const MODULE_KEY = "NCN_SIMULATION";

  function clientToScreen(rect) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const borderLeft = window.outerWidth - window.innerWidth;
    const borderTop = window.outerHeight - window.innerHeight;
    return {
      x: Math.round(window.screenX + borderLeft + cx),
      y: Math.round(window.screenY + borderTop + cy),
    };
  }

  function findElement(selector) {
    return document.querySelector(selector);
  }

  /** Đọc thông tin tình huống hiện tại */
  function readSituation() {
    const titleEl = findElement("#top_practicing_screen_title");
    const questionEl = findElement(".question-content");
    const hintEl = findElement(".mark-video-question + span");

    const situationTitle = (titleEl?.textContent || "").trim();
    const situationQuestion = (questionEl?.textContent || "").trim();

    let contextHint = "";
    const parent = document.querySelector(".mark-video-question")?.parentElement;
    if (parent) {
      const spans = parent.querySelectorAll("span");
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text.toLowerCase().includes("nhấn space") || text.toLowerCase().includes("nhấn phím")) {
          contextHint = text;
          break;
        }
      }
    }
    if (!contextHint && hintEl) {
      contextHint = hintEl.textContent.trim();
    }

    return { situationTitle, situationQuestion, contextHint };
  }

  /** Lấy tọa độ màn hình của nút Play/Pause */
  function getPlayButtonCoords() {
    const btn = findElement("button.action-play");
    if (!btn) return null;

    const iconEl = btn.querySelector("i[icon]");
    const target = iconEl || btn;
    const rect = target.getBoundingClientRect();

    const cx = iconEl
      ? rect.left + rect.width / 2
      : rect.left + rect.width * 0.18;

    const cy = rect.top + rect.height / 2;
    return {
      x: Math.round(window.screenX + cx),
      y: Math.round(window.screenY + cy),
    };
  }

  /** Lấy tọa độ màn hình của nút "Bấm hoặc dùng phím cách - Space để dừng" */
  function getStopButtonCoords() {
    let btn = findElement("button.action-space");
    if (!btn) {
      const allButtons = document.querySelectorAll("button");
      for (const b of allButtons) {
        const t = (b.textContent || "").toLowerCase();
        if (t.includes("space") && t.includes("dừng")) {
          btn = b;
          break;
        }
      }
    }
    if (!btn) return null;

    const textEl = btn.querySelector(".ant-spin-container");
    const target = textEl || btn;
    const rect = target.getBoundingClientRect();

    const cx = textEl
      ? rect.left + rect.width / 2
      : rect.left + rect.width * 0.18;

    const cy = rect.top + rect.height / 2;

    const borderLeft = window.outerWidth - window.innerWidth;
    const borderTop = window.outerHeight - window.innerHeight;

    const offsetY = 0// 80 + Math.floor(Math.random() * 21);

    return {
      x: Math.round(window.screenX + borderLeft + cx),
      y: Math.round(window.screenY + borderTop + cy + offsetY),
    };
  }

  /** Lấy thời lượng video (giây) */
  function getVideoDuration() {
    const video = document.querySelector("video");
    if (!video || !isFinite(video.duration)) return null;
    return video.duration;
  }

  /** Kiểm tra video đang chạy hay không (icon pause = đang chạy) */
  function isVideoPlaying() {
    const btn = findElement("button.action-play");
    if (!btn) return false;
    const icon = btn.querySelector("i");
    if (!icon) return false;
    const iconAttr = icon.getAttribute("icon");
    return iconAttr === "pause";
  }

  /** Lấy thời gian hiện tại của video (giây) */
  function getVideoCurrentTime() {
    const video = document.querySelector("video");
    if (!video || !isFinite(video.currentTime)) return 0;
    return video.currentTime;
  }

  /** Đọc % đã played trên thanh tracking */
  function getPlayedPercent() {
    const played = findElement(".media-audio-tracking-bar__played");
    if (!played) return null;
    const w = played.style.width;
    if (!w) return null;
    const pct = parseFloat(w);
    if (isNaN(pct)) return null;
    return pct;
  }

  /**
   * Tính giây dừng đúng từ marks trên thanh tracking bar.
   * Tìm mark có backgroundColor = rgb(0, 142, 44) (xanh lá = đáp án đúng).
   * stopSecond = leftPercent / 100 * videoDuration
   */
  function calculateStopTimeFromMarks() {
    const videoDuration = getVideoDuration();
    const marks = document.querySelectorAll(".media-audio-tracking-bar__mark");

    if (!marks || marks.length === 0) {
      return { error: "Không tìm thấy marks trên thanh tracking bar" };
    }

    const TARGET_COLOR = "rgb(0, 142, 44)";
    let bestMark = null;
    let bestLeft = null;

    for (const mark of marks) {
      const style = mark.style || {};
      const bg = style.backgroundColor;
      const left = style.left;

      if (!left) continue;

      if (bg === TARGET_COLOR) {
        bestMark = mark;
        bestLeft = left;
        break;
      }
    }

    if (!bestLeft) {
      return { error: "Không tìm thấy mark xanh lá (rgb(0, 142, 44))" };
    }

    const stopPercent = parseFloat(bestLeft);
    if (isNaN(stopPercent)) {
      return { error: `Giá trị left không hợp lệ: ${bestLeft}` };
    }

    let stopSecond = null;
    if (videoDuration && isFinite(videoDuration) && videoDuration > 0) {
      stopSecond = (stopPercent / 100) * videoDuration;
    }

    return {
      stopSecond: stopSecond ? Math.round(stopSecond * 100) / 100 : null,
      stopPercent,
      videoDuration: videoDuration ? Math.round(videoDuration * 1000) / 1000 : null,
      markColor: TARGET_COLOR,
      hasDuration: Boolean(videoDuration),
    };
  }

  /** Lấy tọa độ màn hình của nút "Tiếp" */
  function getNextButtonCoords() {
    const btns = document.querySelectorAll("button.ant-btn-primary");
    for (const btn of btns) {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (text.includes("tiếp")) {
        const span = btn.querySelector("span");
        const target = span || btn;
        const rect = target.getBoundingClientRect();
        const borderLeft = window.outerWidth - window.innerWidth;
        const borderTop = window.outerHeight - window.innerHeight;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return {
          x: Math.round(window.screenX + borderLeft + cx),
          y: Math.round(window.screenY + borderTop + cy),
        };
      }
    }
    return null;
  }

  /** Lấy tọa độ màn hình của nút Replay/Làm lại (action-rollback) */
  function getReplayButtonCoords() {
    const btn = findElement("button.action-rollback");
    if (!btn) return null;
    const container = btn.querySelector(".ant-spin-container");
    const target = container || btn;
    const rect = target.getBoundingClientRect();
    const borderLeft = window.outerWidth - window.innerWidth;
    const borderTop = window.outerHeight - window.innerHeight;
    const cx = container ? rect.left + rect.width / 2 : rect.left + rect.width * 0.18 + 30;
    const cy = rect.top + rect.height / 2;
    return {
      x: Math.round(window.screenX + borderLeft + cx),
      y: Math.round(window.screenY + borderTop + cy),
    };
  }

  /** Đọc điểm: { score: 3, max: 5 } hoặc null nếu chưa có */
  function getScoreInfo() {
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const text = (div.textContent || "").trim();
      const m = text.match(/Điểm của bạn:\s*(\d+)\s*\/\s*(\d+)/i);
      if (m) {
        return { score: parseInt(m[1], 10), max: parseInt(m[2], 10) };
      }
    }
    return null;
  }

  /** Lấy tọa độ màn hình của nút "Kết thúc luyện thi" */
  function getFinishButtonCoords() {
    const btns = document.querySelectorAll("button");
    for (const btn of btns) {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (text.includes("kết thúc") && text.includes("luyện")) {
        const rect = btn.getBoundingClientRect();
        const borderLeft = window.outerWidth - window.innerWidth;
        const borderTop = window.outerHeight - window.innerHeight;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return {
          x: Math.round(window.screenX + borderLeft + cx),
          y: Math.round(window.screenY + borderTop + cy),
        };
      }
    }
    return null;
  }

  window[MODULE_KEY] = {
    readSituation,
    getPlayButtonCoords,
    getStopButtonCoords,
    getNextButtonCoords,
    getReplayButtonCoords,
    getFinishButtonCoords,
    getVideoDuration,
    getVideoCurrentTime,
    getPlayedPercent,
    isVideoPlaying,
    getScoreInfo,
    calculateStopTimeFromMarks,
  };
})();
