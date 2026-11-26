// @ts-check
// Run night (B5): renders HostView for every phase and sends the host commands (TECH-SPEC
// 7.2, 10.3). Built with Arrow (3.4); the server decides what is allowed through `view.can`.
import { html } from "/vendor/arrow/index.mjs";
import { lockup } from "/static/shared/mark.mjs";
import { askingScreen, roundIntroScreen } from "./asking.js";
import { deadlockScreen } from "./deadlock.js";
import { displayNow, endAction, phaseSteps, primaryAction, topTitle } from "./logic.js";
import { idleEnter, idleScreen, lobbyEnter, lobbyScreen, openDisplay, prizesDialog } from "./lobby.js";
import { markingScreen, pendingNote } from "./marking.js";
import { disputeDialog, endedScreen, halftimeScreen, leaderboardScreen, loadDetail, revealScreen } from "./results.js";
import { closeDialog, enabled, openDialog, page, send, setClient, toggleHideAnswers, ui } from "./state.js";
import { moveDialog, offlineCount, removeDialog, renameDialog, sideTeams, teamDialog, teamsDialog } from "./teams.js";
import { cmdButton, dialogFrame, mountParts, nextButton } from "./ui.js";

/** @typedef {import("../../../src/shared/protocol").HostView} HostView */

const loadingScreen = () => html`<div class="stage"><p class="muted">Connecting to Lock-In…</p></div>`;

/** @type {Record<string, () => any>} */
const SCREENS = {
  loading: loadingScreen,
  idle: idleScreen,
  lobby: lobbyScreen,
  round_intro: roundIntroScreen,
  asking: askingScreen,
  marking: markingScreen,
  reveal: revealScreen,
  leaderboard: leaderboardScreen,
  halftime: halftimeScreen,
  sudden_death: deadlockScreen,
  ended: endedScreen,
};

/** @type {Record<string, () => any>} */
const DIALOGS = {
  team: teamDialog,
  teams: teamsDialog,
  rename: renameDialog,
  remove: removeDialog,
  move: moveDialog,
  prizes: prizesDialog,
  dispute: disputeDialog,
  menu: menuDialog,
  confirmEnd: confirmEndDialog,
  closeNight: closeNightDialog,
};

// ---- Top bar, side panel, banners --------------------------------------------

function topBar() {
  const t = () => topTitle(page.view);
  return html`<header class="topbar">
    <a class="host-brand" href="/host">${lockup(html)}</a>
    <span class="${() => `title${page.view?.phase === "sudden_death" ? " deadlock-word" : ""}`}">${() => t().title}</span>
    <span class="room">Room <b class="code">${() => page.view?.night?.roomCode || ""}</b></span>
    <span class="pill warn" hidden="${() => !(page.view?.marking && page.view.marking.pendingTotal > 0 && (page.view.phase === "marking" || page.view.phase === "asking"))}"><i></i>${() => `${page.view?.marking?.pendingTotal || 0} left to mark`}</span>
    <button type="button" class="pill warn as-btn" hidden="${() => !offlineCount()}" @click="${() => openDialog("teams")}"><i></i>${() => `${offlineCount()} team${offlineCount() === 1 ? "" : "s"} offline`}</button>
    <nav class="phase-steps" aria-label="Where the night is">${PHASE_STEPS.map((label, i) => html`<span class="${() => (phaseSteps(page.view) === i ? "now" : phaseSteps(page.view) > i ? "done" : "")}">${label}</span>`)}</nav>
    <button type="button" class="btn menu-btn" aria-haspopup="menu" aria-expanded="${() => String(ui.dialog === "menu")}" @click="${() => (ui.dialog === "menu" ? closeDialog() : openDialog("menu"))}">Night menu ▾</button>
  </header>`;
}

const PHASE_STEPS = ["Lobby", "Ask", "Lock", "Reveal", "Table"];

function runFoot() {
  return html`<div class="run-foot" hidden="${() => page.screen === "idle" || page.screen === "loading"}">
    <div class="display-now">
      <p class="label">On the display now</p>
      <div class="displayprev">${() => displayNow(page.view)}</div>
    </div>
    ${nextButton(() => primaryAction(page.view, page.now))}
  </div>`;
}

function sidePanel() {
  return html`<aside class="side" hidden="${() => page.screen === "idle" || page.screen === "loading"}">
    <div class="sec muted s" hidden="${() => page.screen !== "lobby"}">Joining closes when you start. Teams that drop out can still rejoin.</div>
    <div class="sec s" hidden="${() => page.screen !== "marking"}"><b>${pendingNote}</b><p class="muted">The reveal waits until every answer is marked.</p></div>
    <div hidden="${() => !(page.view?.night && page.view.phase !== "lobby")}">${sideTeams(() => page.view?.phase === "asking" && !!page.view.current && page.view.current.status === "open")}</div>
    <div class="sec secondary" hidden="${() => page.screen !== "marking" && page.screen !== "reveal"}">${cmdButton("leaderboard.show", "Skip the reveal, go to the leaderboard", { cls: "ghost wide" })}</div>
  </aside>`;
}

function banners() {
  return html`<div class="lockin-offline banner" role="status" hidden="${() => page.status !== "offline"}">Reconnecting to Lock-In… Buttons come back when the connection does.</div>
    <div class="error-bar" role="alert" hidden="${() => !ui.error}"><span>${() => ui.error}</span><button type="button" class="btn ghost small" @click="${() => { ui.error = ""; }}">OK</button></div>`;
}

// ---- Night menu and confirmations ---------------------------------------------

function menuDialog() {
  return html`<div class="menu-layer" @click="${(/** @type {Event} */ e) => { if (e.target === e.currentTarget) closeDialog(); }}">
    <div class="menu night-menu" role="menu" aria-label="Night menu">
      <button type="button" role="menuitem" hidden="${() => !page.view?.night}" @click="${() => { closeDialog(); openDisplay(); }}">Open display in a new window</button>
      <button type="button" role="menuitem" hidden="${() => !page.view?.night}" @click="${() => openDialog("teams")}">Teams: rename, move to a new phone, remove</button>
      <button type="button" role="menuitem" hidden="${() => !(page.view?.night && enabled("night.update"))}" @click="${() => openDialog("prizes", { prizes: (page.view?.night?.prizes || []).map((p) => ({ text: p.text })) })}">Prizes tonight</button>
      <button type="button" role="menuitemcheckbox" aria-checked="${() => (ui.hideAnswers ? "true" : "false")}" @click="${toggleHideAnswers}">Hide answers on this screen<span class="${() => (ui.hideAnswers ? "mini-switch on" : "mini-switch")}" aria-hidden="true"></span></button>
      <hr>
      <button type="button" role="menuitem" class="${() => (endAction(page.view)?.tone === "danger" ? "danger-text" : "")}" hidden="${() => !endAction(page.view)}"
        @click="${() => { const a = endAction(page.view); if (a) openDialog("confirmEnd", { action: a }); }}">${() => { const l = endAction(page.view)?.label || ""; return endAction(page.view)?.tone === "danger" ? l + "…" : l; }}</button>
      <button type="button" role="menuitem" class="danger-text" hidden="${() => !(page.view?.phase === "lobby" && enabled("night.close"))}" @click="${() => openDialog("closeNight")}">Close the night without starting…</button>
      <a role="menuitem" class="muted" href="/host">Back to the console menu</a>
    </div>
  </div>`;
}

function confirmEndDialog() {
  const a = () => ui.d.action;
  const early = () => !!(a() && a().args && a().args.early);
  return dialogFrame(() => (early() ? "End the quiz early?" : "End the quiz?"), html`<p>${() => (early()
    ? "The night ends now. Scores so far become the final standings, the display shows the winner, and the night is saved in History. This cannot be undone."
    : "The display shows the winner and the final standings, and the night is saved in History. Marks can no longer be changed after this.")}</p>`,
  html`<button type="button" class="btn ghost" @click="${closeDialog}">Keep going</button>
    <button type="button" class="${() => (early() ? "btn danger-fill" : "btn primary")}" disabled="${() => !enabled("quiz.end")}"
      @click="${async () => { const x = a(); if ((await send("quiz.end", x ? x.args : {})).ok) closeDialog(); }}">${() => (early() ? "End the quiz now" : "End the quiz")}</button>`);
}

function closeNightDialog() {
  return dialogFrame("Close the night without starting?", html`<p>The quiz has not started. Closing sends every phone back to the join page and the display to the venue's waiting screen. Nothing is scored.</p>`,
    html`<button type="button" class="btn ghost" @click="${closeDialog}">Keep the lobby open</button>
      <button type="button" class="btn danger-fill" disabled="${() => !enabled("night.close")}"
        @click="${async () => { if ((await send("night.close", {})).ok) closeDialog(); }}">Close the night</button>`);
}

// ---- Page --------------------------------------------------------------------

html`${banners()}
  ${topBar()}
  <div class="${() => `runbody${page.screen === "idle" || page.screen === "loading" ? " no-side" : ""}${page.status === "offline" ? " is-offline" : ""}${ui.hideAnswers ? " hide-answers" : ""}`}">
    <div class="main-col"><main class="main" id="host-main"></main>${runFoot()}</div>
    ${sidePanel()}
  </div>
  <div class="dialogs"></div>`(/** @type {HTMLElement} */ (document.getElementById("app")));

// Screens and dialogs are built once and then shown and hidden (Arrow 1.0.6, see ui.js).
/** @type {Record<string, () => void>} */
const ON_SCREEN = { idle: idleEnter, lobby: lobbyEnter, reveal: loadDetail };
mountParts(/** @type {HTMLElement} */ (document.getElementById("host-main")), SCREENS,
  () => (SCREENS[page.screen] ? page.screen : "loading"), (name) => ON_SCREEN[name]?.());
mountParts(/** @type {HTMLElement} */ (document.querySelector("#app .dialogs")), DIALOGS, () => ui.dialog, (name, box) => {
  if (name === "dispute") loadDetail();
  // Put the keyboard in the dialog: its first field, else its close button.
  const f = /** @type {HTMLElement | null} */ (box.querySelector("input, .dialog .close"));
  if (f) f.focus();
});

const client = window.LockIn.connect({
  role: "host",
  onState(/** @type {HostView} */ view) {
    page.view = view;
    // While a night is open the run header replaces the console nav (Last Call, "Running a question").
    const open = !!view.night;
    document.body.classList.toggle("night-open", open);
    window.LockIn.nav?.setNight(open && view.night ? view.night.roomCode : null);
    if (page.screen !== view.phase) {
      page.screen = view.phase;
      ui.markQ = "";
      if (ui.dialog === "confirmEnd" || ui.dialog === "closeNight") closeDialog();
    }
  },
  onStatus(/** @type {string} */ status) {
    page.status = status;
  },
  onBye(/** @type {string} */ reason) {
    if (reason === "signed_out") location.href = "/host/login?next=/host/run";
    else ui.error = "This console was disconnected by Lock-In. Reload the page to connect again.";
  },
});
setClient(client);

// Timers count down from the view's locksAt with the shared clock (10.6).
setInterval(() => { page.now = client.clock.now(); }, 250);

// "Hide answers on this screen": tapping a blurred answer shows it for a few seconds.
// The mark is a data attribute, so Arrow's own class updates never undo it.
document.addEventListener("click", (e) => {
  if (!ui.hideAnswers) return;
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.(".secret"));
  if (!el || el.hasAttribute("data-peek")) return;
  el.setAttribute("data-peek", "");
  setTimeout(() => el.removeAttribute("data-peek"), 5000);
});

// Escape closes a dialog from anywhere on the page.
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.dialog) closeDialog(); });
