// @ts-check
// Run night (B5): renders HostView for every phase and sends the host commands (TECH-SPEC
// 7.2, 10.3). Built with Arrow (3.4); the server decides what is allowed through `view.can`.
import { html } from "/vendor/arrow/index.mjs";
import { askingScreen, roundIntroScreen } from "./asking.js";
import { deadlockScreen } from "./deadlock.js";
import { displayNow, endAction, primaryAction, topTitle } from "./logic.js";
import { idleScreen, lobbyScreen, openDisplay, prizesDialog } from "./lobby.js";
import { markingScreen, pendingNote } from "./marking.js";
import { disputeDialog, endedScreen, halftimeScreen, leaderboardScreen, revealScreen } from "./results.js";
import { closeDialog, enabled, openDialog, page, send, setClient, ui } from "./state.js";
import { moveDialog, offlineCount, removeDialog, renameDialog, sideTeams, teamDialog, teamsDialog } from "./teams.js";
import { cmdButton, dialogFrame, nextButton } from "./ui.js";

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
    <span class="${() => `title${page.view?.phase === "sudden_death" ? " deadlock-word" : ""}`}">${() => t().title}</span>
    <span class="muted s">${() => t().sub}</span>
    ${() => (page.view?.marking && page.view.marking.pendingTotal > 0 && (page.view.phase === "marking" || page.view.phase === "asking")
      ? html`<span class="pill warn">${() => `${page.view?.marking?.pendingTotal || 0} left to mark`}</span>` : "")}
    <span class="spacer"></span>
    ${() => (page.view?.night ? html`<span class="s muted">Room <b class="code">${() => page.view?.night?.roomCode || ""}</b></span>` : "")}
    ${() => (offlineCount() ? html`<button type="button" class="pill warn as-btn" @click="${() => openDialog("teams")}"><i></i>${() => `${offlineCount()} team${offlineCount() === 1 ? "" : "s"} offline`}</button>` : "")}
    ${() => (page.view?.night ? html`<button type="button" class="btn ghost" @click="${openDisplay}">Open display</button>` : "")}
    <button type="button" class="btn ghost menu-btn" aria-haspopup="dialog" @click="${() => openDialog("menu")}">Night menu ▾</button>
  </header>`;
}

function sidePanel() {
  return html`<aside class="side">
    <div class="sec">
      <h3 class="label">On the display now</h3>
      <div class="displayprev">${() => displayNow(page.view)}</div>
    </div>
    ${() => sideExtra()}
    ${() => (page.view?.night && page.view.phase !== "lobby" ? sideTeams(() => page.view?.phase === "asking" && !!page.view.current && page.view.current.status === "open") : "")}
    ${nextButton(() => primaryAction(page.view))}
    ${() => sideSecondary()}
  </aside>`;
}

/** A short explanation under the display preview, by phase. */
function sideExtra() {
  switch (page.screen) {
    case "lobby": return html`<div class="sec muted s">Joining closes when you start. Teams that drop out can still rejoin.</div>`;
    case "marking": return html`<div class="sec s"><b>${pendingNote}</b><p class="muted">The reveal waits until every answer is marked.</p></div>`;
    default: return "";
  }
}

/** Second actions under the big button. */
function sideSecondary() {
  switch (page.screen) {
    case "marking":
    case "reveal":
      return html`<div class="sec secondary">${cmdButton("leaderboard.show", "Skip the reveal, go to the leaderboard", { cls: "ghost wide" })}</div>`;
    default:
      return "";
  }
}

function banners() {
  return html`
    ${() => (page.status === "offline" ? html`<div class="lockin-offline banner" role="status">Reconnecting to Lock-In… Buttons come back when the connection does.</div>` : "")}
    ${() => (ui.error ? html`<div class="error-bar" role="alert"><span>${() => ui.error}</span><button type="button" class="btn ghost small" @click="${() => { ui.error = ""; }}">OK</button></div>` : "")}`;
}

// ---- Night menu and confirmations ---------------------------------------------

function menuDialog() {
  return dialogFrame("Night menu", html`<div class="stack">
    ${() => (page.view?.night ? html`<button type="button" class="btn" @click="${() => { closeDialog(); openDisplay(); }}">Open display in a new window</button>` : "")}
    ${() => (page.view?.night ? html`<button type="button" class="btn" @click="${() => openDialog("teams")}">Teams: rename, move to a new phone, remove</button>` : "")}
    ${() => (page.view?.night && enabled("night.update") ? html`<button type="button" class="btn" @click="${() => openDialog("prizes", { prizes: (page.view?.night?.prizes || []).map((p) => ({ text: p.text })) })}">Prizes tonight</button>` : "")}
    ${() => { const a = endAction(page.view); return a ? html`<button type="button" class="${a.tone === "danger" ? "btn danger" : "btn"}" @click="${() => openDialog("confirmEnd", { action: a })}">${a.label}</button>` : ""; }}
    ${() => (page.view?.phase === "lobby" && enabled("night.close") ? html`<button type="button" class="btn danger" @click="${() => openDialog("closeNight")}">Close the night without starting</button>` : "")}
    <a class="btn ghost" href="/host">Back to the console menu</a>
  </div>`);
}

function confirmEndDialog() {
  const a = ui.d.action;
  const early = !!(a && a.args && a.args.early);
  return dialogFrame(early ? "End the quiz early?" : "End the quiz?", html`<p>${early
    ? "The night ends now. Scores so far become the final standings, the display shows the winner, and the night is saved in History. This cannot be undone."
    : "The display shows the winner and the final standings, and the night is saved in History. Marks can no longer be changed after this."}</p>`,
  html`<button type="button" class="btn ghost" @click="${closeDialog}">Keep going</button>
    <button type="button" class="${early ? "btn danger-fill" : "btn primary"}" disabled="${() => !enabled("quiz.end")}"
      @click="${async () => { if ((await send("quiz.end", a ? a.args : {})).ok) closeDialog(); }}">${early ? "End the quiz now" : "End the quiz"}</button>`);
}

function closeNightDialog() {
  return dialogFrame("Close the night without starting?", html`<p>The quiz has not started. Closing sends every phone back to the join page and the display to the venue's waiting screen. Nothing is scored.</p>`,
    html`<button type="button" class="btn ghost" @click="${closeDialog}">Keep the lobby open</button>
      <button type="button" class="btn danger-fill" disabled="${() => !enabled("night.close")}"
        @click="${async () => { if ((await send("night.close", {})).ok) closeDialog(); }}">Close the night</button>`);
}

// ---- Page --------------------------------------------------------------------

html`${banners}
  ${topBar()}
  <div class="${() => `runbody${page.screen === "idle" || page.screen === "loading" ? " no-side" : ""}${page.status === "offline" ? " is-offline" : ""}`}">
    <main class="main" id="host-main">${() => [(SCREENS[page.screen] || loadingScreen)().key(page.screen)]}</main>
    ${() => (page.screen === "idle" || page.screen === "loading" ? "" : sidePanel())}
  </div>
  ${() => (ui.dialog && DIALOGS[ui.dialog] ? [/** @type {() => any} */ (DIALOGS[ui.dialog])().key(ui.dialog)] : "")}`(/** @type {HTMLElement} */ (document.getElementById("app")));

/** @type {any} */
const LockIn = /** @type {any} */ (window).LockIn;
const client = LockIn.connect({
  role: "host",
  onState(/** @type {HostView} */ view) {
    page.view = view;
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

// Escape closes a dialog from anywhere on the page.
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.dialog) closeDialog(); });
