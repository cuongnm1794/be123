/**
 * MAIN world — phải chạy trước script trang (manifest document_start + inject lại khi SPA).
 */
(function installGuard() {
  "use strict";

  const LOG = "[NCN guard]";

  function isDevtoolsShortcut(e) {
    const key = (e.key || "").toUpperCase();
    if (key === "F12") return true;
    if (e.ctrlKey && e.shiftKey && ["I", "J", "C", "K"].includes(key)) return true;
    if (e.ctrlKey && key === "U") return true;
    return false;
  }

  function bindListenersOnce() {
    if (window.__NCN_GUARD_LISTENERS__) return;
    window.__NCN_GUARD_LISTENERS__ = true;

    ["keydown", "keyup", "keypress"].forEach((type) => {
      window.addEventListener(
        type,
        (e) => {
          if (isDevtoolsShortcut(e)) e.stopImmediatePropagation();
        },
        true
      );
    });

    window.addEventListener(
      "contextmenu",
      (e) => {
        e.stopImmediatePropagation();
      },
      true
    );
  }

  function patchOuterSize() {
    try {
      Object.defineProperty(window, "outerWidth", {
        configurable: true,
        get() {
          return window.innerWidth;
        },
      });
      Object.defineProperty(window, "outerHeight", {
        configurable: true,
        get() {
          return window.innerHeight;
        },
      });
    } catch (err) {
      console.warn(LOG, "outerWidth/Height:", err);
    }
  }

  function isDebuggerProbe(fn) {
    if (typeof fn !== "function") return false;
    const body = fn
      .toString()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, "");
    return /debugger;?/.test(body) && body.length < 200;
  }

  function patchTimers() {
    const nativeSetInterval = window.__NCN_NATIVE_SETINTERVAL__ || window.setInterval.bind(window);
    const nativeSetTimeout = window.__NCN_NATIVE_SETTIMEOUT__ || window.setTimeout.bind(window);
    if (!window.__NCN_NATIVE_SETINTERVAL__) {
      window.__NCN_NATIVE_SETINTERVAL__ = nativeSetInterval;
      window.__NCN_NATIVE_SETTIMEOUT__ = nativeSetTimeout;
    }

    window.setInterval = function (fn, delay, ...args) {
      if (isDebuggerProbe(fn)) {
        return nativeSetInterval(() => {}, delay || 1000);
      }
      return nativeSetInterval(fn, delay, ...args);
    };

    window.setTimeout = function (fn, delay, ...args) {
      if (isDebuggerProbe(fn)) {
        return nativeSetTimeout(() => {}, delay || 0);
      }
      return nativeSetTimeout(fn, delay, ...args);
    };
  }

  function patchDefineProperty() {
    if (window.__NCN_DEFINE_PROPERTY_PATCHED__) return;
    window.__NCN_DEFINE_PROPERTY_PATCHED__ = true;

    const nativeDefineProperty = Object.defineProperty;
    Object.defineProperty = function (target, prop, descriptor) {
      if (
        descriptor &&
        typeof descriptor.get === "function" &&
        (prop === "id" || prop === "className")
      ) {
        const getSrc = descriptor.get.toString();
        if (/devtools|debugger|outerWidth|innerWidth|isOpen/i.test(getSrc)) {
          descriptor = { ...descriptor, get: () => "" };
        }
      }
      return nativeDefineProperty(target, prop, descriptor);
    };
  }

  function patchLocation() {
    if (window.__NCN_LOCATION_PATCHED__) return;
    window.__NCN_LOCATION_PATCHED__ = true;

    const nativeAssign = Location.prototype.assign;
    const nativeReplace = Location.prototype.replace;

    function shouldBlockNav(url) {
      return typeof url === "string" && /devtools|debug=true|anti.?debug/i.test(url);
    }

    Location.prototype.assign = function (url) {
      if (shouldBlockNav(url)) {
        console.warn(LOG, "chặn assign:", url);
        return;
      }
      return nativeAssign.call(this, url);
    };

    Location.prototype.replace = function (url) {
      if (shouldBlockNav(url)) {
        console.warn(LOG, "chặn replace:", url);
        return;
      }
      return nativeReplace.call(this, url);
    };
  }

  function hookSpaNavigation() {
    if (window.__NCN_SPA_HOOK__) return;
    window.__NCN_SPA_HOOK__ = true;

    const reinstall = () => queueMicrotask(installGuard);

    const wrapHistory = (name) => {
      const original = history[name];
      if (typeof original !== "function") return;
      history[name] = function (...args) {
        const result = original.apply(this, args);
        reinstall();
        return result;
      };
    };

    wrapHistory("pushState");
    wrapHistory("replaceState");
    window.addEventListener("popstate", reinstall);
    window.addEventListener("hashchange", reinstall);
  }

  bindListenersOnce();
  patchOuterSize();
  patchTimers();
  patchDefineProperty();
  patchLocation();
  hookSpaNavigation();

  window.__NCN_DEVTOOLS_GUARD__ = true;
})();
