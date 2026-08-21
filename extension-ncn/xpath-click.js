/**
 * Click phần tử theo XPath — mô phỏng chuột (pointer + mouse events).
 */
(function () {
  function getElementByXPath(xpath, root = document) {
    const expr = String(xpath || "").trim();
    if (!expr) throw new Error("XPath trống");

    const node = document.evaluate(
      expr,
      root,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    if (!node) throw new Error(`Không tìm thấy phần tử: ${expr}`);
    if (node.nodeType !== Node.ELEMENT_NODE) {
      throw new Error("XPath không trỏ tới phần tử HTML (element)");
    }
    return node;
  }

  /**
   * Mô phỏng click chuột. Mặc định chỉ dispatch synthetic events (1 lần).
   * nativeOnly: true → chỉ gọi element.click() (dùng cho nút Ant Design).
   */
  function assertDomInteractionAllowed() {
    if (window.NCN_PAGE_READ_ONLY) {
      throw new Error(
        "Không click DOM trên trang — dùng server click (popup)."
      );
    }
  }

  function simulateMouseClick(element, options = {}) {
    assertDomInteractionAllowed();
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });

    if (options.nativeOnly) {
      if (typeof element.click === "function") {
        element.click();
      }
      return;
    }

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.min(rect.width / 2, Math.max(rect.width - 1, 1));
    const clientY = rect.top + Math.min(rect.height / 2, Math.max(rect.height - 1, 1));

    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: window.screenX + clientX,
      screenY: window.screenY + clientY,
      button: 0,
      buttons: 1,
      composed: true,
    };

    const sequence = [
      ["pointerover", PointerEvent],
      ["mouseover", MouseEvent],
      ["pointerenter", PointerEvent],
      ["mouseenter", MouseEvent],
      ["pointerdown", PointerEvent],
      ["mousedown", MouseEvent],
      ["pointerup", PointerEvent],
      ["mouseup", MouseEvent],
      ["click", MouseEvent],
    ];

    for (const [type, EventClass] of sequence) {
      const init = { ...base };
      if (type === "click") init.detail = 1;
      element.dispatchEvent(new EventClass(type, init));
    }
  }

  function clickByXPath(xpath, options = {}) {
    assertDomInteractionAllowed();
    const expr = String(xpath || "").trim();
    const element = getElementByXPath(expr);
    simulateMouseClick(element, options);

    return {
      ok: true,
      xpath: expr,
      tag: element.tagName,
      id: element.id || null,
      className: element.className || null,
      text: (element.textContent || "").trim().slice(0, 80),
    };
  }

  window.NCN_XPATH = { getElementByXPath, simulateMouseClick, clickByXPath };
})();
