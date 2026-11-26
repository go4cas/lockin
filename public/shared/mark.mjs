// @ts-check
// The lock in mark (docs/DESIGN-SYSTEM.md, "Logo"): a keyhole inside the circular countdown
// ring. Drawn inline, not as a file, so the arc (the time left) takes the venue colour and
// the rest follows the text colour. The files in assets/logo/ are for favicons and pages
// that cannot draw it. No imports; `html` comes from the caller.

/**
 * The mark alone.
 * @param {(strings: TemplateStringsArray, ...values: any[]) => any} html Arrow's html
 * @param {string} [cls] extra classes: "mono" draws the arc in the text colour too
 */
export function mark(html, cls) {
  return html`<svg class="${"mark" + (cls ? " " + cls : "")}" viewBox="0 0 100 100" aria-hidden="true"><circle class="mk-ring" cx="50" cy="50" r="38" stroke-dasharray="179 239" stroke-dashoffset="-60" transform="rotate(-90 50 50)"></circle><circle class="mk-arc" cx="50" cy="50" r="38" stroke-dasharray="54 239" transform="rotate(-90 50 50)"></circle><circle class="mk-hole" cx="50" cy="45" r="8"></circle><path class="mk-hole" d="M45 48 L55 48 L57 66 L43 66 Z"></path></svg>`;
}

/**
 * The lockup: the mark and the lowercase wordmark "lock in" in Funnel Display Medium.
 * @param {(strings: TemplateStringsArray, ...values: any[]) => any} html
 * @param {string} [cls] extra classes on the lockup ("mono" for a one-colour lockup)
 */
export function lockup(html, cls) {
  return html`<span class="${"lockup" + (cls ? " " + cls : "")}" role="img" aria-label="lock in">${mark(html, cls && cls.indexOf("mono") >= 0 ? "mono" : "")}<span class="lockup-word" aria-hidden="true">lock in</span></span>`;
}
