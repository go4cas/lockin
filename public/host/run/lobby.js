// @ts-check
// Idle (open a night) and lobby screens (H-05, H-06, H-15, H-17 on the console).
import { html, reactive } from "/vendor/arrow/index.mjs";
import { cleanPrizes, hhmm, ordinal, plannedFromInput } from "./logic.js";
import { closeDialog, enabled, getJson, openDialog, page, send, serverNow, ui } from "./state.js";
import { lobbyTeams } from "./teams.js";
import { dialogFrame, pool } from "./ui.js";

/** @typedef {{ id: string, title: string, rounds: number, questions: number, updatedAt: number, ready: boolean, problems: string[] }} QuizRow */

// ---- Idle: open a night ----------------------------------------------------

const open = reactive({
  loading: true,
  problem: "",
  /** @type {QuizRow[]} */ quizzes: [],
  quizId: "",
  planned: "",
  /** @type {{ text: string }[]} */ prizes: [],
});

let loadedOnce = false;

async function loadLibrary() {
  open.loading = true;
  open.problem = "";
  try {
    const [lib, venue] = await Promise.all([
      getJson("/api/quizzes"),
      getJson("/api/venue").catch(() => null),
    ]);
    open.quizzes = (lib && lib.quizzes) || [];
    // The Library's "Open a night" links here with ?quiz=<id> (B3); preselect it when it is ready.
    const asked = new URLSearchParams(location.search).get("quiz");
    const wanted = open.quizzes.find((q) => q.ready && q.id === asked);
    const firstReady = open.quizzes.find((q) => q.ready);
    if (!open.quizId) open.quizId = wanted ? wanted.id : firstReady ? firstReady.id : "";
    if (!loadedOnce && venue && Array.isArray(venue.prizes)) {
      open.prizes = venue.prizes.map((/** @type {{ text: string }} */ p) => ({ text: p.text }));
    }
    loadedOnce = true;
  } catch (e) {
    open.problem = /** @type {Error} */ (e).message;
  } finally {
    open.loading = false;
  }
}

/** Each time the console comes to the Open a night screen. */
export function idleEnter() {
  loadLibrary();
}

export function idleScreen() {
  const submit = async (/** @type {Event} */ e) => {
    e.preventDefault();
    if (!open.quizId) { ui.error = "Pick a ready quiz first."; return; }
    const plannedStart = open.planned ? plannedFromInput(open.planned, serverNow()) : null;
    if (open.planned && plannedStart === null) { ui.error = "Type the start time as hours and minutes, like 19:30."; return; }
    await send("night.open", { quizId: open.quizId, plannedStart, prizes: cleanPrizes(open.prizes) });
  };
  return html`<div class="stage">
    <h1>Open a night</h1>
    <p class="muted">Pick tonight's quiz. Teams can join as soon as the night is open; the quiz starts when you press Start.</p>
    <form class="stack open-form" @submit="${submit}">
      <section class="card">
        <div class="row between"><h3 class="label">Quiz</h3><a class="link" href="/host/build">Library</a></div>
        <p class="muted" hidden="${() => !open.loading}">Loading the quiz library…</p>
        <p class="form-error" hidden="${() => !open.problem}">${() => open.problem} <button type="button" class="link" @click="${loadLibrary}">Try again</button></p>
        <p class="muted" hidden="${() => !(!open.loading && !open.problem && open.quizzes.length === 0)}">No quizzes yet. Make one in the <a href="/host/build">Library</a> first.</p>
        <ul class="quiz-pick">${pool(() => open.quizzes, (q) => html`<li hidden="${() => !q()}">
          <label class="${() => `quiz-opt${q()?.ready ? "" : " not-ready"}${q() && open.quizId === q()?.id ? " on" : ""}`}">
            <input type="radio" name="quiz" value="${() => q()?.id || ""}" checked="${() => !!q() && open.quizId === q()?.id}" disabled="${() => !q()?.ready}"
              @change="${() => { const x = q(); if (x) open.quizId = x.id; }}">
            <span class="q-title">${() => q()?.title || ""}</span>
            <span class="muted s">${() => `${q()?.rounds ?? 0} rounds · ${q()?.questions ?? 0} questions`}</span>
            <span class="pill ok" hidden="${() => !q()?.ready}"><i></i>Ready</span><span class="pill warn" hidden="${() => !!q()?.ready}"><i></i>Not ready</span>
            <span class="problems s" hidden="${() => !!q()?.ready}">${() => (q()?.problems || []).slice(0, 2).join(" ")}</span>
          </label></li>`)}</ul>
      </section>
      <div class="two">
        <section class="card">
          <label class="label" for="open-planned">Planned start (optional)</label>
          <input id="open-planned" class="input time" type="time" value="${() => open.planned}"
            @input="${(/** @type {Event} */ e) => { open.planned = /** @type {HTMLInputElement} */ (e.target).value; }}">
          <p class="muted s">Drives the countdown on the holding page. Leave it empty for no countdown.</p>
        </section>
        <section class="card">
          <h3 class="label">Prizes tonight (optional)</h3>
          ${prizeRows(open)}
        </section>
      </div>
      <div><button type="submit" class="btn next inline" disabled="${() => !enabled("night.open") || !open.quizId}">Open the night</button></div>
    </form>
  </div>`;
}

/**
 * Editable prize rows: one text per place.
 * @param {{ prizes: { text: string }[] }} store
 */
function prizeRows(store) {
  return html`<ol class="prize-rows">${pool(() => store.prizes, (p, i) => html`<li hidden="${() => !p()}">
      <span class="place">${ordinal(i + 1)}</span>
      <input class="input" maxlength="80" aria-label="${`Prize for ${ordinal(i + 1)} place`}" value="${() => p()?.text ?? ""}"
        @input="${(/** @type {Event} */ e) => { const row = store.prizes[i]; if (row) row.text = /** @type {HTMLInputElement} */ (e.target).value; }}">
      <button type="button" class="btn ghost" aria-label="${`Remove the ${ordinal(i + 1)} place prize`}" @click="${() => { store.prizes.splice(i, 1); }}">×</button>
    </li>`)}</ol>
    <button type="button" class="btn ghost" @click="${() => { store.prizes.push({ text: "" }); }}">+ Add a prize</button>`;
}

// ---- Lobby -----------------------------------------------------------------

async function loadServer() {
  if (ui.displayUrl) return;
  try {
    const s = await getJson("/api/server");
    if (s && typeof s.displayUrl === "string") ui.displayUrl = s.displayUrl;
  } catch {
    /* B8's /api/server not there yet: fall back to this console's address */
  }
  if (!ui.displayUrl) ui.displayUrl = `${location.origin}/display`;
}

/** Strips the scheme for showing an address: "quiz.example.com/display". */
/** @param {string} url */
function bare(url) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function openDisplay() {
  window.open("/display", "lockin-display", "noopener");
}

/** Each time the console comes to the lobby. */
export function lobbyEnter() {
  loadServer();
  ui.planned = "";
  ui.plannedDirty = false;
}

export function lobbyScreen() {
  const savePlanned = async () => {
    const v = ui.planned.trim();
    const plannedStart = v ? plannedFromInput(v, serverNow()) : null;
    if (v && plannedStart === null) { ui.error = "Type the start time as hours and minutes, like 19:30."; return; }
    if ((await send("night.update", { plannedStart })).ok) ui.plannedDirty = false;
  };
  return html`<div class="stage">
    <div class="two lobby-top">
      <section class="card join-card">
        <img class="qr" src="/qr/join.svg" alt="${() => `QR code for ${page.view?.night?.joinUrl || "the join page"}`}" width="132" height="132">
        <div>
          <h3 class="label">Teams join at</h3>
          <p class="join-url">${() => (page.view && page.view.night ? bare(page.view.night.joinUrl).replace(/\/j\/[^/]+$/, "") : "")}</p>
          <h3 class="label">Room code</h3>
          <p class="room-code">${() => page.view?.night?.roomCode || ""}</p>
        </div>
      </section>
      <section class="card display-card">
        <h3 class="label">Put this on the display</h3>
        <p class="join-url">${() => bare(ui.displayUrl)}</p>
        <p class="muted s">Open it in the TV's browser, or press Open display and drag the new window to the TV (extend the screen, don't mirror it). The display needs no remote after that.</p>
        <div class="row"><button type="button" class="btn primary" @click="${openDisplay}">Open display</button>
          <img class="qr small" src="/qr/display.svg" alt="${() => `QR code for ${ui.displayUrl}`}" width="88" height="88"></div>
      </section>
    </div>
    <div class="two">
      <section class="card">
        <label class="label" for="lobby-planned">Planned start</label>
        <div class="row">
          <input id="lobby-planned" class="input time" type="time"
            value="${() => (ui.plannedDirty ? ui.planned : hhmm(page.view?.night?.plannedStart))}"
            @input="${(/** @type {Event} */ e) => { ui.planned = /** @type {HTMLInputElement} */ (e.target).value; ui.plannedDirty = true; }}">
          <button type="button" class="btn primary" hidden="${() => !ui.plannedDirty}" disabled="${() => !enabled("night.update")}" @click="${savePlanned}">Save</button>
          <span class="muted s">${() => holdingNote()}</span>
        </div>
      </section>
      <section class="card">
        <h3 class="label">Prizes tonight</h3>
        <p class="prizes">${() => prizeLine()}</p>
        <button type="button" class="btn" disabled="${() => !enabled("night.update")}" @click="${openPrizes}">Edit prizes</button>
      </section>
    </div>
    ${lobbyTeams()}
  </div>`;
}

function holdingNote() {
  const n = page.view && page.view.night;
  if (!n || n.plannedStart === null) return "No start time: the holding page shows no countdown.";
  if (n.holdingFrom === null) return `Starts at ${hhmm(n.plannedStart)}.`;
  return n.holdingFrom <= serverNow() ? "The holding page and countdown are on the display now." : `Holding page with countdown from ${hhmm(n.holdingFrom)}.`;
}

function prizeLine() {
  const n = page.view && page.view.night;
  if (!n || n.prizes.length === 0) return "No prizes tonight. Nothing about prizes shows.";
  return n.prizes.map((p) => `${ordinal(p.place)}: ${p.text}`).join(" · ");
}

function openPrizes() {
  const n = page.view && page.view.night;
  openDialog("prizes", { prizes: n ? n.prizes.map((p) => ({ text: p.text })) : [] });
}

export function prizesDialog() {
  const store = { get prizes() { return /** @type {{ text: string }[]} */ (ui.d.prizes || []); } };
  const save = async () => {
    if ((await send("night.update", { prizes: cleanPrizes(store.prizes) })).ok) closeDialog();
  };
  return dialogFrame("Prizes tonight", html`<p class="muted s">Shown in the lobby, on the holding page, at halftime and at the winner moment. Leave them empty for no prizes.</p>${prizeRows(store)}`,
    html`<button type="button" class="btn ghost" @click="${closeDialog}">Cancel</button>
      <button type="button" class="btn primary" disabled="${() => !enabled("night.update")}" @click="${save}">Save prizes</button>`);
}
