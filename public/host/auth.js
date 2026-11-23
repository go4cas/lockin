// @ts-check
// Setup and sign-in forms (TECH-SPEC 12.1, 12.2).
(function () {
  "use strict";
  const errorBox = document.getElementById("form-error");

  /** @param {string | null} message */
  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  }

  /** Where to go after signing in: only a /host path from ?next=. */
  function nextPage() {
    const next = new URLSearchParams(location.search).get("next");
    return next && /^\/host(\/[a-z-]*)?$/.test(next) ? next : "/host";
  }

  /**
   * @param {string} url
   * @param {object} body
   * @param {HTMLButtonElement | null} button
   */
  async function post(url, body, button) {
    showError(null);
    if (button) button.disabled = true;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        location.href = nextPage();
        return;
      }
      const data = await res.json().catch(() => null);
      showError((data && data.error && data.error.message) || "That did not work. Try again.");
    } catch {
      showError("Lock-In could not be reached. Check the connection and try again.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  const setup = /** @type {HTMLFormElement | null} */ (document.getElementById("setup-form"));
  if (setup) {
    setup.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = /** @type {HTMLInputElement} */ (setup.elements.namedItem("setupCode")).value.trim();
      const pw = /** @type {HTMLInputElement} */ (setup.elements.namedItem("password")).value;
      const pw2 = /** @type {HTMLInputElement} */ (setup.elements.namedItem("password2")).value;
      if (code.length !== 8) return showError("The setup code has 8 characters.");
      if (pw.length < 8) return showError("The password must be at least 8 characters.");
      if (pw !== pw2) return showError("The two passwords are not the same.");
      post("/api/auth/setup", { setupCode: code, password: pw }, setup.querySelector("button"));
    });
  }

  const login = /** @type {HTMLFormElement | null} */ (document.getElementById("login-form"));
  if (login) {
    login.addEventListener("submit", (e) => {
      e.preventDefault();
      const pw = /** @type {HTMLInputElement} */ (login.elements.namedItem("password")).value;
      if (!pw) return showError("Type the host password.");
      post("/api/auth/login", { password: pw }, login.querySelector("button"));
    });
  }
})();
