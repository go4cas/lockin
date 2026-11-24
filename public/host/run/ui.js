// @ts-check
// Small reusable pieces for the Run night console (TECH-SPEC 3.4): command buttons,
// pills, team dots and the dialog frame. Text always goes through ${} slots (12.4).
import { html } from "/vendor/arrow/index.mjs";
import { closeDialog, enabled, openDialog, page, send, ui } from "./state.js";

/** @typedef {import("../../../src/shared/protocol").CommandName} CommandName */
/** @typedef {import("../../../src/shared/protocol").HostTeam} HostTeam */
/** @typedef {import("./logic.js").Action} Action */

/**
 * A button that sends one host command. Disabled unless `view.can` allows it, the
 * console is online and the same command is not waiting for its ack (10.5).
 * @param {CommandName} name
 * @param {string | (() => string)} label
 * @param {{ cls?: string, args?: object | (() => object), confirm?: () => void, title?: string }} [opts]
 */
export function cmdButton(name, label, opts = {}) {
  const cls = `btn ${opts.cls || ""}`;
  const click = () => {
    if (opts.confirm) return opts.confirm();
    const args = typeof opts.args === "function" ? opts.args() : opts.args;
    send(name, args);
  };
  return html`<button type="button" class="${cls}" data-cmd="${name}" disabled="${() => !enabled(name)}" @click="${click}">${label}</button>`;
}

/**
 * The big next-step button at the bottom of the side panel, from logic.primaryAction.
 * @param {() => Action | null} get
 */
export function nextButton(get) {
  const click = () => {
    const a = get();
    if (!a) return;
    if (a.confirm) openDialog("confirmEnd", { action: a });
    else send(a.name, a.args);
  };
  return html`<div class="next-wrap">
    <button type="button" class="${() => `btn next${get()?.tone === "danger" ? " danger-fill" : ""}`}" data-next="${() => get()?.name || ""}"
      disabled="${() => { const a = get(); return !a || page.status !== "online" || !!ui.busy[a.name] || !(page.view && page.view.can[a.name]); }}"
      @click="${click}">${() => get()?.label || "Waiting…"}</button>
    <p class="next-hint">${() => get()?.hint || ""}</p>
  </div>`;
}

/**
 * Team colour dot. Colour is never the only marker: the name always sits next to it.
 * @param {() => number} colour
 */
export function dot(colour) {
  return html`<span class="dot" style="${() => `background: var(--team-${colour() || 1})`}"></span>`;
}

/**
 * Phone status pill for a team: offline beats everything (H-06).
 * @param {() => HostTeam | undefined} team
 * @param {boolean} [answered]  show "Answered / Not yet" while a question is open
 */
export function phonePill(team, answered) {
  const state = () => {
    const t = team();
    if (!t) return "off";
    if (!t.connected) return "off";
    if (answered) return t.answeredCurrent ? "ok" : "wait";
    return "ok";
  };
  const text = () => {
    const s = state();
    if (s === "off") return "Offline";
    if (s === "wait") return "Not yet";
    return answered ? "Answered" : "Connected";
  };
  return html`<span class="${() => `pill ${state() === "off" ? "warn" : state() === "ok" ? "ok" : ""}`}"><i></i>${text}</span>`;
}

/**
 * The frame every dialog uses. Closing it never sends anything.
 * @param {string} title
 * @param {any} body
 * @param {any} [actions]
 */
export function dialogFrame(title, body, actions) {
  return html`<div class="overlay" @click="${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) closeDialog(); }}">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="${title}" @keydown="${(/** @type {Event} */ e) => { if (/** @type {KeyboardEvent} */ (e).key === "Escape") closeDialog(); }}">
      <div class="dialog-head"><h2>${title}</h2><button type="button" class="btn ghost close" aria-label="Close" @click="${closeDialog}">×</button></div>
      <div class="dialog-body">${() => body}</div>
      ${() => (actions ? html`<div class="dialog-actions">${() => actions}</div>` : "")}
    </div>
  </div>`;
}

/** A plain section heading in small capitals. */
/** @param {string} text */
export function label(text) {
  return html`<h3 class="label">${text}</h3>`;
}
