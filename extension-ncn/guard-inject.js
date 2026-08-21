/**
 * Isolated world, document_start — inject guard vào page ngay (không đợi service worker).
 */
(function () {
  const GUARD_URL = chrome.runtime.getURL("devtools-guard.js");

  function injectGuard() {
    if (document.documentElement?.dataset?.ncnGuardInjected === "1") return;
    if (document.documentElement) {
      document.documentElement.dataset.ncnGuardInjected = "1";
    }

    const script = document.createElement("script");
    script.src = GUARD_URL;
    script.async = false;

    const root = document.documentElement || document.head || document;
    root.insertBefore(script, root.firstChild);
  }

  injectGuard();

  chrome.storage.sync.get({ bypassDevtoolsDetect: true }, (data) => {
    if (data.bypassDevtoolsDetect === false && document.documentElement) {
      document.documentElement.dataset.ncnGuardOff = "1";
    }
  });
})();
