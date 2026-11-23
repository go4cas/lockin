// @ts-check
// Small helpers for rendering views safely (TECH-SPEC 12.4: text always goes
// through textContent, never innerHTML). TV baseline: ES2017 classic script.
(/** @param {any} root */ function (root) {
  "use strict";
  var LockIn = root.LockIn || (root.LockIn = {});

  /**
   * Creates an element. Children may be elements, strings (set as text) or null.
   * @param {string} tag
   * @param {Object<string, any>} [attrs] class, text, hidden, data-*, aria-*, on<event> handlers, or any attribute
   * @param {Array<any>} [children]
   * @returns {HTMLElement}
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    var keys = attrs ? Object.keys(attrs) : [];
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i]);
      var v = attrs ? attrs[k] : undefined;
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = String(v);
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    var list = children || [];
    for (var j = 0; j < list.length; j++) {
      var c = list[j];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  /**
   * Replaces a node's children.
   * @param {Element} node
   * @param {Array<any>} children
   */
  function replace(node, children) {
    while (node.firstChild) node.removeChild(node.firstChild);
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }

  /**
   * Formats milliseconds as "m:ss", or "s" under a minute when short is true.
   * @param {number} ms
   * @param {boolean} [short]
   */
  function countdown(ms, short) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    if (short && m === 0) return String(s);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /**
   * "A", "A and B", "A, B and C" (TECH-SPEC 5.5 winner_shared).
   * @param {string[]} names
   */
  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  /**
   * CSS colour for a 1-based team colour index.
   * @param {number} index
   */
  function teamColour(index) {
    return "var(--team-" + index + ")";
  }

  LockIn.view = { el: el, replace: replace, countdown: countdown, joinNames: joinNames, teamColour: teamColour };
})(typeof window !== "undefined" ? window : globalThis);
