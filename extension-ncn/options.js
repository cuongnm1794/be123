const form = document.getElementById("options-form");
const saveStatus = document.getElementById("save-status");

function secToMs(sec, fallbackSec) {
  return Math.max(0, Number(sec) || fallbackSec) * 1000;
}

async function load() {
  const data = await chrome.storage.sync.get({
    subfolder: "namcaonguyen-sources",
    includeTimestamp: true,
    saveAsDialog: false,
    showFloatingBar: false,
    bypassDevtoolsDetect: true,
    answerApiUrl: "http://localhost:3003/api/answer",
    insertApiUrl: "http://localhost:3003/api/insert",
    clickServerUrl: "http://127.0.0.1:8765/click",
    serverNextDelayMinMs: 2_000,
    serverNextDelayMaxMs: 5_000,
    intentionalWrongRate: 0.05,
    autoPickFirstOnNotFound: true,
    defaultAnswerPosition: 0,
    answerDelayMinMs: 3_000,
    answerDelayMaxMs: 8_000,
    nextDelayMinMs: 1_000,
    nextDelayMaxMs: 1_000,
    autoClickNext: true,
    alertOnNotFound: true,
    autoLookupIndex: true,
  });

  document.getElementById("subfolder").value = data.subfolder;
  document.getElementById("includeTimestamp").checked = data.includeTimestamp;
  document.getElementById("saveAsDialog").checked = data.saveAsDialog;
  document.getElementById("showFloatingBar").checked = data.showFloatingBar;
  document.getElementById("bypassDevtoolsDetect").checked = data.bypassDevtoolsDetect;
  document.getElementById("answerApiUrl").value = data.answerApiUrl;
  document.getElementById("insertApiUrl").value = data.insertApiUrl;
  document.getElementById("clickServerUrl").value = data.clickServerUrl;
  document.getElementById("serverNextDelayMinSec").value = Math.round(
    (data.serverNextDelayMinMs ?? 2_000) / 1000
  );
  document.getElementById("serverNextDelayMaxSec").value = Math.round(
    (data.serverNextDelayMaxMs ?? 5_000) / 1000
  );
  document.getElementById("intentionalWrongPercent").value = Math.round(
    (data.intentionalWrongRate ?? 0.05) * 100
  );
  document.getElementById("autoLookupIndex").checked = data.autoLookupIndex !== false;
  document.getElementById("autoPickFirstOnNotFound").checked = data.autoPickFirstOnNotFound !== false;
  document.getElementById("defaultAnswerPosition").value = data.defaultAnswerPosition ?? 0;
  document.getElementById("answerDelayMinSec").value = Math.round((data.answerDelayMinMs ?? 3_000) / 1000);
  document.getElementById("answerDelayMaxSec").value = Math.round((data.answerDelayMaxMs ?? 8_000) / 1000);
  document.getElementById("nextDelayMinSec").value = Math.round((data.nextDelayMinMs ?? 1_000) / 1000);
  document.getElementById("nextDelayMaxSec").value = Math.round((data.nextDelayMaxMs ?? 1_000) / 1000);
  document.getElementById("autoClickNext").checked = data.autoClickNext !== false;
  document.getElementById("alertOnNotFound").checked = data.alertOnNotFound !== false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    subfolder: document.getElementById("subfolder").value.trim() || "namcaonguyen-sources",
    includeTimestamp: document.getElementById("includeTimestamp").checked,
    saveAsDialog: document.getElementById("saveAsDialog").checked,
    showFloatingBar: false,
    bypassDevtoolsDetect: document.getElementById("bypassDevtoolsDetect").checked,
    answerApiUrl:
      document.getElementById("answerApiUrl").value.trim() ||
      "http://localhost:3003/api/answer",
    insertApiUrl:
      document.getElementById("insertApiUrl").value.trim() ||
      "http://localhost:3003/api/insert",
    clickServerUrl:
      document.getElementById("clickServerUrl").value.trim() ||
      "http://127.0.0.1:8765/click",
    serverNextDelayMinMs: secToMs(document.getElementById("serverNextDelayMinSec").value, 2),
    serverNextDelayMaxMs: secToMs(document.getElementById("serverNextDelayMaxSec").value, 5),
    intentionalWrongRate: Math.min(
      0.5,
      Math.max(0, Number(document.getElementById("intentionalWrongPercent").value) || 0) / 100
    ),
    autoLookupIndex: document.getElementById("autoLookupIndex").checked,
    autoPickFirstOnNotFound: document.getElementById("autoPickFirstOnNotFound").checked,
    defaultAnswerPosition: Math.max(
      0,
      Number(document.getElementById("defaultAnswerPosition").value) || 0
    ),
    answerDelayMinMs: secToMs(document.getElementById("answerDelayMinSec").value, 3),
    answerDelayMaxMs: secToMs(document.getElementById("answerDelayMaxSec").value, 8),
    nextDelayMinMs: secToMs(document.getElementById("nextDelayMinSec").value, 1),
    nextDelayMaxMs: secToMs(document.getElementById("nextDelayMaxSec").value, 1),
    autoClickNext: document.getElementById("autoClickNext").checked,
    alertOnNotFound: document.getElementById("alertOnNotFound").checked,
  };

  if (payload.answerDelayMinMs > payload.answerDelayMaxMs) {
    [payload.answerDelayMinMs, payload.answerDelayMaxMs] = [
      payload.answerDelayMaxMs,
      payload.answerDelayMinMs,
    ];
  }
  if (payload.nextDelayMinMs > payload.nextDelayMaxMs) {
    [payload.nextDelayMinMs, payload.nextDelayMaxMs] = [
      payload.nextDelayMaxMs,
      payload.nextDelayMinMs,
    ];
  }
  if (payload.serverNextDelayMinMs > payload.serverNextDelayMaxMs) {
    [payload.serverNextDelayMinMs, payload.serverNextDelayMaxMs] = [
      payload.serverNextDelayMaxMs,
      payload.serverNextDelayMinMs,
    ];
  }

  await chrome.storage.sync.set(payload);
  saveStatus.textContent = "Đã lưu. Tải lại trang web để áp dụng thanh nổi (nếu đổi).";

  chrome.tabs.query({ url: "https://namcaonguyen.huelms.com/*" }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.reload(tab.id);
    }
  });
});

load();
