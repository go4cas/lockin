// @ts-check
// Small reusable pieces for the Run night console (TECH-SPEC 3.4): command buttons,
// pills, team dots and the dialog frame. Text always goes through ${} slots (12.4).
import { html, watch } from "/vendor/arrow/index.mjs";
import { pool, retained } from "/static/shared/parts.mjs";
import { closeDialog, enabled, openDialog, page, send, ui } from "./state.js";

/** @typedef {import("../../../src/shared/protocol").CommandName} CommandName */
/** @typedef {import("../../../src/shared/protocol").HostTeam} HostTeam */
/** @typedef {import("./logic.js").Action} Action */

/**
 * A button that sends one host command. Disabled unless `view.can` allows it, the
 * console is online and the same command is not waiting for its ack (10.5).
 * @param {CommandName} name
 * @param {string | (() => string)} label
 * @param {{ cls?: string, args?: object | (() => object), confirm?: () => void, title?: string, show?: () => boolean }} [opts]
 */
export function cmdButton(name, label, opts = {}) {
  const cls = `btn ${opts.cls || ""}`;
  const click = () => {
    if (opts.confirm) return opts.confirm();
    const args = typeof opts.args === "function" ? opts.args() : opts.args;
    send(name, args);
  };
  return html`<button type="button" class="${cls}" data-cmd="${name}" hidden="${() => (opts.show ? !opts.show() : false)}" disabled="${() => !enabled(name)}" @click="${click}">${label}</button>`;
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
 * The frame every dialog uses. Closing it never sends anything. Dialogs are built once
 * and reused, so anything that depends on the open dialog's data is a function.
 * @param {string | (() => string)} title
 * @param {any} body
 * @param {any} [actions]
 */
export function dialogFrame(title, body, actions) {
  return html`<div class="overlay" @click="${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) closeDialog(); }}">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="${title}" @keydown="${(/** @type {Event} */ e) => { if (/** @type {KeyboardEvent} */ (e).key === "Escape") closeDialog(); }}">
      <div class="dialog-head"><h2>${title}</h2><button type="button" class="btn ghost close" aria-label="Close" @click="${closeDialog}">×</button></div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-actions" hidden="${!actions}">${actions || ""}</div>
    </div>
  </div>`;
}

/** A plain section heading in small capitals. */
/** @param {string} text */
export function label(text) {
  return html`<h3 class="label">${text}</h3>`;
}

// ---- Arrow 1.0.6 safety helpers (NOTES, "B5 host console: findings") ----------------
// Arrow throws "expressionPool[effect] is not a function" when a template is removed
// while one of its own slots is queued by the same change, and the throw drops the rest
// of that update (a button can stay disabled for good). So the console never removes a
// template that has live slots inside: lists are row pools that only grow, conditional
// pieces are always there and toggled with `hidden`, and screens and dialogs are built
// once and then hidden and shown (mountParts).

/** Row pools (shared with the phone, see public/shared/parts.mjs). */
export { pool };

/**
 * Shows one of several parts (screens, dialogs) in `holder`. Each part is built once,
 * the first time it is asked for, and then only hidden and shown: in Arrow 1.0.6 a
 * removed template's watchers keep running, so rebuilding screens slowed the console
 * down with every phase change (NOTES). Showing happens one microtask after the change.
 * @param {HTMLElement} holder
 * @param {Record<string, () => any>} parts
 * @param {() => string} current  the part to show; "" or an unknown name shows none
 * @param {(name: string, box: HTMLElement) => void} [onShow]
 */
export function mountParts(holder, parts, current, onShow) {
  const boxes = retained(holder, "part", "part");
  watch(current, () => {
    queueMicrotask(() => {
      const name = current();
      if (name === boxes.showing()) return;
      const build = name ? parts[name] : undefined;
      const box = build ? boxes.ensure(name, (b) => build()(b)) : null;
      boxes.show(name);
      if (box && onShow) onShow(name, box);
    });
  });
}
