/**
 * Log hoạt động extension — lưu chrome.storage.local + hiển thị khi bấm Trạng thái.
 */
(function () {
  const STORAGE_KEY = "ncnActivityLog";
  const MAX_ENTRIES = 120;

  const memory = [];

  function nowTime() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function truncate(value, max = 280) {
    const s =
      typeof value === "string" ? value : JSON.stringify(value, null, 0) || "";
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  function persist() {
    const slice = memory.slice(-MAX_ENTRIES);
    chrome.storage.local.set({ [STORAGE_KEY]: slice }).catch(() => {});
  }

  function loadFromStorage() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [STORAGE_KEY]: [] }, (data) => {
        const stored = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
        if (stored.length && !memory.length) {
          memory.push(...stored.slice(-MAX_ENTRIES));
        }
        resolve(memory);
      });
    });
  }

  /**
   * @param {"flow"|"api"|"page"|"status"} category
   */
  function log(category, message, detail = null) {
    let detailStr = null;
    if (detail != null) {
      detailStr = truncate(
        typeof detail === "string" ? detail : JSON.stringify(detail)
      );
    }
    const entry = {
      t: Date.now(),
      time: nowTime(),
      category: category || "flow",
      message: String(message || ""),
      detail: detailStr,
    };
    memory.push(entry);
    if (memory.length > MAX_ENTRIES) {
      memory.splice(0, memory.length - MAX_ENTRIES);
    }
    persist();
    console.log(`[NCN][${entry.category}] ${entry.message}`, detail || "");
    return entry;
  }

  function logApi(method, path, request, response, error) {
    const url = path || "/api";
    if (error) {
      log("api", `${method} ${url} ← LỖI`, {
        request,
        error: String(error),
      });
      return;
    }
    log("api", `${method} ${url} ← OK`, { request, response });
  }

  function formatEntry(entry) {
    const cat = entry.category ? `[${entry.category}]` : "";
    let line = `${entry.time} ${cat} ${entry.message}`;
    if (entry.detail) {
      line += `\n    ${entry.detail.replace(/\n/g, "\n    ")}`;
    }
    return line;
  }

  function formatRecent(count = 25) {
    const n = Math.max(1, Number(count) || 25);
    const items = memory.slice(-n);
    if (!items.length) {
      return "── Log (chưa có) ──\nChưa có log — chạy Trả lời / loop trước.";
    }
    return `── Log (${items.length} mới nhất) ──\n${items.map(formatEntry).join("\n")}`;
  }

  function getEntries() {
    return [...memory];
  }

  function clear() {
    memory.length = 0;
    chrome.storage.local.set({ [STORAGE_KEY]: [] }).catch(() => {});
  }

  window.NCN_LOG = {
    log,
    logApi,
    formatRecent,
    formatEntry,
    getEntries,
    clear,
    loadFromStorage,
    MAX_ENTRIES,
  };

  loadFromStorage();
})();
