// @ts-check
// Team tools (H-06): the lobby table, the side list during the night, and the rename,
// move-to-a-new-phone and remove dialogs.
import { html } from "/vendor/arrow/index.mjs";
import { closeDialog, enabled, openDialog, page, send, ui } from "./state.js";
import { dialogFrame, dot, phonePill, pool } from "./ui.js";

/** @typedef {import("../../../src/shared/protocol").HostTeam} HostTeam */

/** @param {string} id */
export function teamById(id) {
  const v = page.view;
  return v ? v.teams.find((t) => t.id === id) : undefined;
}

/** @param {string} id */
function teamName(id) {
  const t = teamById(id);
  return t ? t.name : (ui.d.name || "This team");
}

/**
 * The ⋯ button and its small menu for one team.
 * @param {() => string} id
 */
export function teamMenuButton(id) {
  return html`<button type="button" class="btn ghost more" aria-label="${() => `Team tools for ${teamName(id())}`}" data-team-menu="${id}"
    @click="${() => { const x = id(); if (x) openDialog("team", { id: x, name: teamName(x) }); }}">⋯</button>`;
}

/** @returns {HostTeam[]} */
const allTeams = () => (page.view ? page.view.teams : []);

/** The lobby's team table: name, colour, phone status and tools. */
export function lobbyTeams() {
  return html`<section class="card teams-card">
    <div class="row between"><h3 class="label">${() => `Teams (${page.view ? page.view.teams.length : 0})`}</h3>
      <span class="muted s">Rename, move to a new phone or remove from the ⋯ menu</span></div>
    <p class="muted empty" hidden="${() => !(page.view && page.view.teams.length === 0)}">No teams yet. They join by scanning the QR code or typing the room code.</p>
    <table class="team-table">
      <thead><tr><th>Team</th><th>Phone</th><th class="right"><span class="visually-hidden">Tools</span></th></tr></thead>
      <tbody>${pool(allTeams, teamRow)}</tbody>
    </table>
  </section>`;
}

/** @param {() => HostTeam | undefined} team */
function teamRow(team) {
  return html`<tr class="${() => (team() && !team()?.connected ? "offline" : "")}" hidden="${() => !team()}">
    <td><span class="tname">${dot(() => team()?.colour || 1)}<b>${() => team()?.name || ""}</b></span></td>
    <td>${phonePill(team)}</td>
    <td class="right">${teamMenuButton(() => team()?.id || "")}</td>
  </tr>`;
}

/**
 * One team in a side or dialog list.
 * @param {() => HostTeam | undefined} t
 * @param {() => boolean} [showAnswered]
 */
function teamItem(t, showAnswered) {
  return html`<li class="${() => `tm${t()?.connected === false ? " offline" : ""}`}" hidden="${() => !t()}">
      ${dot(() => t()?.colour || 1)}<span class="n">${() => t()?.name || ""}</span>
      <span class="pill joker" title="Joker on this round" hidden="${() => !(showAnswered && t()?.jokerThisRound)}">Joker</span>
      <span hidden="${() => !!(showAnswered && showAnswered())}">${phonePill(t)}</span>
      <span hidden="${() => !(showAnswered && showAnswered())}">${phonePill(t, true)}</span>
      ${teamMenuButton(() => t()?.id || "")}
    </li>`;
}

/**
 * The side list of teams: answered / not yet while a question is open, offline always.
 * @param {() => boolean} showAnswered
 */
export function sideTeams(showAnswered) {
  return html`<div class="sec side-teams">
    <div class="row between"><h3 class="label">Teams</h3>
      <button type="button" class="link" @click="${() => openDialog("teams")}">Manage</button></div>
    <ul class="tm-list">${pool(allTeams, (t) => teamItem(t, showAnswered))}</ul>
  </div>`;
}

/** Offline teams count for the top bar. */
export function offlineCount() {
  return page.view ? page.view.teams.filter((t) => !t.connected).length : 0;
}

// ---- Dialogs ---------------------------------------------------------------

/** The tools for one team. */
export function teamDialog() {
  const id = () => /** @type {string} */ (ui.d.id || "");
  return dialogFrame("Team tools", html`
    <p class="team-head">${dot(() => teamById(id())?.colour || 1)}<b>${() => teamName(id())}</b> ${phonePill(() => teamById(id()))}</p>
    <p class="muted s" hidden="${() => !(teamById(id()) && !teamById(id())?.connected)}">Their phone is offline. If it died, move the team to a new phone: they keep their name, answers and score.</p>
    <div class="stack">
      <button type="button" class="btn" disabled="${() => !enabled("team.rename")}" @click="${() => openDialog("rename", { id: id(), name: teamName(id()), text: teamName(id()) })}">Rename</button>
      <button type="button" class="btn" disabled="${() => !enabled("team.moveCode")}" @click="${() => moveTeam(id())}">Move to a new phone</button>
      <button type="button" class="btn danger" hidden="${() => page.view?.phase !== "lobby"}" disabled="${() => !enabled("team.remove")}" @click="${() => openDialog("remove", { id: id(), name: teamName(id()) })}">Remove team</button>
      <p class="muted s" hidden="${() => page.view?.phase === "lobby"}">Teams can only be removed before the quiz starts.</p>
      <button type="button" class="btn" hidden="${() => !(page.view && page.view.standings && enabled("mark.team"))}" @click="${() => openDialog("dispute", { teamId: id(), name: teamName(id()) })}">Change a mark</button>
    </div>`);
}

/** Every team, for the night menu. */
export function teamsDialog() {
  return dialogFrame("Teams", html`<ul class="tm-list">${pool(allTeams, (t) => teamItem(t))}</ul>`);
}

export function renameDialog() {
  const save = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const name = String(ui.d.text || "").trim();
    if (!name) { ui.d.problem = "Type a name."; return; }
    if (name.length > 30) { ui.d.problem = "Keep it to 30 characters."; return; }
    if ((await send("team.rename", { teamId: ui.d.id, name })).ok) closeDialog();
  };
  return dialogFrame(() => `Rename ${ui.d.name || ""}`, html`<form class="stack" @submit="${save}">
      <label class="l" for="rename-input">New name</label>
      <input id="rename-input" class="input" maxlength="30" autocomplete="off" spellcheck="false" value="${() => ui.d.text || ""}"
        @input="${(/** @type {Event} */ e) => { ui.d.text = /** @type {HTMLInputElement} */ (e.target).value; ui.d.problem = ""; }}">
      <p class="form-error">${() => ui.d.problem || ""}</p>
      <p class="muted s">The new name shows on the display and on the team's phone straight away.</p>
      <div class="dialog-actions"><button type="button" class="btn ghost" @click="${closeDialog}">Cancel</button>
        <button type="submit" class="btn primary" disabled="${() => !enabled("team.rename")}">Save name</button></div>
    </form>`);
}

export function removeDialog() {
  return dialogFrame(() => `Remove ${ui.d.name || ""}?`, html`<p>The team disappears from the lobby and their phone goes back to the join page. They can join again with a new name before the quiz starts.</p>`,
    html`<button type="button" class="btn ghost" @click="${closeDialog}">Keep the team</button>
      <button type="button" class="btn danger-fill" disabled="${() => !enabled("team.remove")}"
        @click="${async () => { await send("team.remove", { teamId: ui.d.id }); closeDialog(); }}">Remove the team</button>`);
}

/** @param {string} id */
async function moveTeam(id) {
  const name = teamName(id);
  openDialog("move", { id, name, code: "", url: "", loading: true });
  const res = await send("team.moveCode", { teamId: id });
  if (ui.dialog !== "move" || ui.d.id !== id) return;
  if (!res.ok || !res.result) { closeDialog(); if (res.ok) ui.error = "No move code came back. Try again."; return; }
  ui.d.code = res.result.code;
  ui.d.url = res.result.url;
  ui.d.loading = false;
}

export function moveDialog() {
  return dialogFrame(() => `Move ${ui.d.name || ""} to a new phone`, html`
    <p class="muted" hidden="${() => !ui.d.loading}">Making a move code…</p>
    <div class="move" hidden="${() => !!ui.d.loading}">
          <img class="qr" alt="${() => `QR code for ${ui.d.url}`}" src="${() => (ui.d.code ? `/qr/move/${encodeURIComponent(ui.d.code)}.svg` : "")}" width="180" height="180">
          <div>
            <p>On the new phone, scan the QR code or open:</p>
            <p class="big-url">${() => ui.d.url || ""}</p>
            <p>Move code <b class="code">${() => ui.d.code || ""}</b></p>
            <p class="muted s">The code works once, for 10 minutes. The team keeps its name, answers and score, and the old phone is signed out.</p>
          </div>
        </div>`,
    html`<button type="button" class="btn primary" @click="${closeDialog}">Done</button>`);
}
