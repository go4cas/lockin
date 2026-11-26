// @ts-check
// Display pairing (REVIEW finding 4, TECH-SPEC 12.6): pair a display by the code it shows,
// see the paired displays, unpair one or all. Shown on Run night (idle and lobby) and on
// Venue settings, Displays (Cas, 2026-11-26). Needs the host socket (state.js setClient).
import { html, reactive } from "/vendor/arrow/index.mjs";
import { pairedDisplayLine } from "./logic.js";
import { page, send, serverNow, ui } from "./state.js";
import { pool } from "./ui.js";

const pair = reactive({ code: "", note: "", confirmUnpair: false, /** id of the display waiting for "Unpair" to be confirmed */ confirmOne: "" });

/** @returns {{ id: string, pairedAt: number, lastSeenAt: number, connected: boolean, ip: string | null }[]} */
function pairedList() {
  const d = page.view && /** @type {any} */ (page.view).displays;
  return d && Array.isArray(d.list) ? d.list : [];
}

/** "1 display connected · 2 paired · 1 waiting for a code" from HostView.displays. */
function displaysLine() {
  const d = page.view && /** @type {any} */ (page.view).displays;
  if (!d) return "";
  const parts = [`${d.connected} paired ${d.connected === 1 ? "display" : "displays"} connected`];
  if (d.waiting > 0) parts.push(`${d.waiting} waiting for a code`);
  if (d.bySession > 0) parts.push(`${d.bySession} opened from a signed-in console (unpaired when it signs out)`);
  return parts.join(" · ");
}

const pairReady = (/** @type {string} */ name) => page.status === "online" && !ui.busy[name];

/**
 * What the host is told after pairing (SA-03): where the screen is and how long it waited,
 * so a screen that is not the pub's TV is noticed and unpaired.
 * @param {{ ip?: string; connectedFor?: number } | undefined} r
 */
export function pairedNote(r) {
  const mins = Math.round((r && typeof r.connectedFor === "number" ? r.connectedFor : 0) / 60_000);
  const ago = mins < 1 ? "just now" : mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const where = r && r.ip ? ` at ${r.ip}` : "";
  return `Paired a display${where}, connected ${ago}. Not your TV? Unpair it in the list below.`;
}

/** Pair a display by the code it shows, see what is connected, unpair them all. */
export function pairCard() {
  const submit = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const code = pair.code.replace(/\s+/g, "");
    if (!/^[0-9]{6}$/.test(code)) { ui.error = "The display shows a 6-digit code. Type all six digits."; return; }
    pair.note = "";
    const res = await send("display.pair", { code });
    if (res.ok) {
      pair.code = "";
      pair.note = pairedNote(res.result);
    }
  };
  const unpair = async () => {
    pair.confirmUnpair = false;
    if ((await send("display.unpairAll", {})).ok) pair.note = "Every display is unpaired. Each one now shows a new code.";
  };
  const unpairOne = async (/** @type {string} */ id, /** @type {number} */ index) => {
    pair.confirmOne = "";
    if ((await send("display.unpair", { id })).ok) pair.note = `Display ${index + 1} is unpaired. If it is connected, it now shows a new code.`;
  };
  return html`<section class="card pair-card">
    <h3 class="label">Pair a display</h3>
    <p class="muted s">A display shows nothing of the night until it is paired. Type the 6-digit code it shows. "Open display" from this browser is paired for as long as you stay signed in.</p>
    <form class="row" @submit="${submit}">
      <input class="input pair-input" inputmode="numeric" autocomplete="off" maxlength="7" aria-label="Code shown on the display" placeholder="000000"
        value="${() => pair.code}" @input="${(/** @type {Event} */ e) => { pair.code = /** @type {HTMLInputElement} */ (e.target).value; }}">
      <button type="submit" class="btn primary" disabled="${() => !pairReady("display.pair")}">Pair</button>
    </form>
    <p class="s" hidden="${() => !pair.note}">${() => pair.note}</p>
    <p class="muted s">${() => displaysLine()}</p>
    <ul class="paired-list">${pool(pairedList, (d, i) => html`<li class="row" hidden="${() => !d()}">
      <span class="s">${() => (d() ? pairedDisplayLine(/** @type {any} */ (d()), i, serverNow()) : "")}</span>
      <button type="button" class="link" hidden="${() => !d() || pair.confirmOne === d()?.id}" @click="${() => { pair.confirmOne = d()?.id ?? ""; }}">Unpair</button>
      <button type="button" class="btn danger" hidden="${() => !d() || pair.confirmOne !== d()?.id}" disabled="${() => !pairReady("display.unpair")}"
        @click="${() => { const row = d(); if (row) unpairOne(row.id, i); }}">${() => `Unpair display ${i + 1}`}</button>
      <button type="button" class="btn ghost" hidden="${() => !d() || pair.confirmOne !== d()?.id}" @click="${() => { pair.confirmOne = ""; }}">Cancel</button>
    </li>`)}</ul>
    <div class="row">
      <button type="button" class="link" hidden="${() => pair.confirmUnpair}" @click="${() => { pair.confirmUnpair = true; }}">Unpair every display</button>
      <span class="s" hidden="${() => !pair.confirmUnpair}">Every paired display goes back to showing a code.</span>
      <button type="button" class="btn danger" hidden="${() => !pair.confirmUnpair}" disabled="${() => !pairReady("display.unpairAll")}" @click="${unpair}">Unpair all</button>
      <button type="button" class="btn ghost" hidden="${() => !pair.confirmUnpair}" @click="${() => { pair.confirmUnpair = false; }}">Cancel</button>
    </div>
  </section>`;
}

