// @ts-check
// Branding and venue settings (B4): H-15 venue defaults (prizes), H-16 branding
// with a live preview and readability warnings, H-17 holding page settings.
// Last Call (docs/DESIGN-SYSTEM.md, "Venue branding"): a venue sets its name, logo, ONE
// main colour, the countdown style and the TV picture. Everything else stays Lock-In's.
// Built with Arrow (TECH-SPEC 3.4): the saved settings and the unsaved draft
// live in separate reactive stores; the preview and the warnings read the draft,
// so they change as the QM types, and nothing is written until Save.

import { html, reactive } from "/vendor/arrow/index.mjs";
import { loading, spinner } from "../loading.js";
import { saveDraft } from "./save.js";
import { DEFAULT_INPUTS, checkReadability, deriveBrandTokens, assetUrl } from "./derive.js";
import { countdown } from "/static/shared/countdown.mjs";
import { lockup, mark } from "/static/shared/mark.mjs";
import { pairCard } from "../run/pairing.js";
import { page as hostPage, setClient, ui as hostUi } from "../run/state.js";

/** @typedef {import('../../../src/shared/formats').ThemeFile} ThemeFile */
/** @typedef {import('../../../src/shared/formats').VenueFile} VenueFile */
/** @typedef {import('../../../src/shared/formats').HoldingPanel} HoldingPanel */
/** @typedef {import('../../../src/shared/formats').CountdownStyle} CountdownStyle */
/** @typedef {"branding" | "holding" | "prizes" | "quizzes" | "displays"} Tab */

/** @type {{ id: Tab, label: string }[]} */
const TABS = [
  { id: "branding", label: "Branding" },
  { id: "holding", label: "Holding page" },
  { id: "prizes", label: "Default prizes" },
  { id: "quizzes", label: "Quiz defaults" },
  { id: "displays", label: "Displays" },
];

/** @type {{ id: HoldingPanel, label: string }[]} */
const PANELS = [
  { id: "countdown", label: "Countdown to the start" },
  { id: "teams", label: "Teams that have joined" },
  { id: "join", label: "How to join" },
  { id: "install", label: "Put the quiz on your home screen" },
  { id: "poster", label: "Poster (your picture, or the Lock-In mark when there is none)" },
  { id: "prizes", label: "Prizes" },
];

/** @type {{ id: CountdownStyle, label: string }[]} */
const COUNTDOWNS = [
  { id: "ring", label: "Ring" },
  { id: "number", label: "Number" },
  { id: "bar", label: "Solid bar" },
  { id: "dashed", label: "Dashed bar" },
  { id: "flip", label: "Flip" },
];

/** A few colours that work well, for a quick pick. Mint is Lock-In's own. */
const SUGGESTED = ["#7df0c3", "#ffd166", "#ff8a5c", "#f58fd2", "#c3a8ff", "#6fb6ff", "#b8f05a", "#edede8"];

const ORDINAL = ["", "1st", "2nd", "3rd"];
/** @param {number} n */
const ordinal = (n) => ORDINAL[n] || n + "th";

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** Page state from the server. */
const page = reactive({
  loading: true,
  loadError: "",
  /** @type {Tab} */
  tab: tabFromHash(),
  /** JSON of the saved theme and venue, to tell whether the draft has changed. */
  savedTheme: "",
  savedVenue: "",
  /** The saved theme's copy pools: not edited here (H-23 is Launch), kept as they are on save. */
  /** @type {ThemeFile["copy"]} */
  copy: {},
});

/** Unsaved branding settings (the local store the preview reads). */
const draft = reactive({
  name: "",
  logo: /** @type {string | null} */ (null),
  accent: DEFAULT_INPUTS.accent,
  /** true while the colour is still Lock-In's default, so saving keeps it null */
  accentDefault: true,
  /** @type {CountdownStyle} */
  countdown: "ring",
  /** @type {"ink" | "picture"} */
  bgMode: "ink",
  bgImage: /** @type {string | null} */ (null),
});

/** Unsaved venue settings. */
const venue = reactive({
  // What a new quiz starts with (UI-33). Numbers are kept as typed; the server checks them.
  qdRounds: "6",
  qdQuestions: "5",
  qdTimer: "60",
  qdTeams: "30",
  qdSdMax: "3",
  /** @type {"question" | "round"} */ qdLock: "question",
  /** "auto", "none" or a round number */ qdHalf: "auto",
  qdJoker: false,
  /** @type {"closest" | "range"} */ qdClosest: "closest",
  /** @type {"first" | "all"} */ qdScope: "first",
  minutesBefore: "30",
  panelSeconds: "12",
  /** @type {string | null} "assets/<file>" */
  poster: null,
  /** every panel, in order, with on/off */
  panels: PANELS.map((p) => ({ id: p.id, on: true })),
  /** @type {{ key: number, place: string, text: string, image: string | null }[]} */
  prizes: [],
  /** @type {"timer" | "host"} after the winner screen (T-12) */
  afterMode: "timer",
  afterSeconds: "15",
});

/** Save and upload feedback, per tab. */
const ui = reactive({
  saving: false,
  uploading: "",
  /** @type {{ kind: "ok" | "error", text: string, problems: string[] } | null} */
  message: null,
});

let prizeKey = 1;

// ---------------------------------------------------------------------------
// Theme <-> draft
// ---------------------------------------------------------------------------

/** @param {ThemeFile} t */
function draftFromTheme(t) {
  draft.name = t.name ?? "";
  draft.logo = t.logo;
  draft.accent = t.colours.accent ?? DEFAULT_INPUTS.accent;
  draft.accentDefault = t.colours.accent === null;
  draft.countdown = t.countdown ?? "ring";
  draft.bgMode = t.displayBackground ? "picture" : "ink";
  draft.bgImage = t.displayBackground ? t.displayBackground.image : null;
  page.copy = t.copy;
}

/** @returns {ThemeFile} */
function themeFromDraft() {
  const name = draft.name.trim();
  return {
    format: "lockin.theme/1",
    name: name === "" ? null : name,
    logo: draft.logo,
    colours: { accent: draft.accentDefault ? null : draft.accent },
    countdown: draft.countdown === "ring" ? null : draft.countdown,
    displayBackground: draft.bgMode === "picture" && draft.bgImage ? { image: draft.bgImage } : null,
    copy: page.copy,
  };
}

/** @param {VenueFile} v */
function draftFromVenue(v) {
  venue.minutesBefore = String(v.holding.minutesBefore);
  venue.panelSeconds = String(v.holding.panelSeconds);
  venue.poster = v.holding.poster;
  const on = v.holding.panels;
  venue.panels = [
    ...on.map((id) => ({ id, on: true })),
    ...PANELS.filter((p) => !on.includes(p.id)).map((p) => ({ id: p.id, on: false })),
  ];
  venue.prizes = v.prizes.map((p) => ({ key: prizeKey++, place: String(p.place), text: p.text, image: p.image ?? null }));
  venue.afterMode = v.afterWinner.mode;
  venue.afterSeconds = String(v.afterWinner.seconds);
  const qd = v.quizDefaults;
  venue.qdRounds = String(qd.rounds);
  venue.qdQuestions = String(qd.questionsPerRound);
  venue.qdTimer = String(qd.settings.timerSeconds);
  venue.qdTeams = String(qd.settings.maxTeams);
  venue.qdSdMax = String(qd.settings.suddenDeathMax);
  venue.qdLock = qd.settings.lockMode;
  venue.qdHalf = String(qd.settings.halftimeAfterRound);
  venue.qdJoker = qd.settings.joker;
  venue.qdClosest = qd.settings.closestScoring;
  venue.qdScope = qd.settings.suddenDeathScope;
}

/** A number field as typed: a number when it reads as one, else the text, so the server can say what is wrong. @param {string} v */
const typed = (v) => (v.trim() === "" || !Number.isFinite(Number(v)) ? v : Number(v));

/** @returns {unknown} sent as typed; the server validates it */
function venueFromDraft() {
  const minutes = Number(venue.minutesBefore);
  const seconds = Number(venue.afterSeconds);
  const every = Number(venue.panelSeconds);
  return {
    format: "lockin.venue/1",
    prizes: venue.prizes.map((p) => (p.image ? { place: Number(p.place), text: p.text.trim(), image: p.image } : { place: Number(p.place), text: p.text.trim() })),
    holding: {
      minutesBefore: venue.minutesBefore.trim() === "" || !Number.isFinite(minutes) ? venue.minutesBefore : minutes,
      panels: venue.panels.filter((p) => p.on).map((p) => p.id),
      panelSeconds: venue.panelSeconds.trim() === "" || !Number.isFinite(every) ? venue.panelSeconds : every,
      poster: venue.poster,
    },
    afterWinner: {
      mode: venue.afterMode,
      seconds: venue.afterSeconds.trim() === "" || !Number.isFinite(seconds) ? venue.afterSeconds : seconds,
    },
    quizDefaults: {
      rounds: typed(venue.qdRounds),
      questionsPerRound: typed(venue.qdQuestions),
      settings: {
        lockMode: venue.qdLock,
        timerSeconds: typed(venue.qdTimer),
        halftimeAfterRound: venue.qdHalf === "auto" || venue.qdHalf === "none" ? venue.qdHalf : typed(venue.qdHalf),
        joker: venue.qdJoker,
        maxTeams: typed(venue.qdTeams),
        suddenDeathScope: venue.qdScope,
        suddenDeathMax: typed(venue.qdSdMax),
        closestScoring: venue.qdClosest,
      },
    },
  };
}

const themeDirty = () => !page.loading && JSON.stringify(themeFromDraft()) !== page.savedTheme;
const venueDirty = () => !page.loading && JSON.stringify(venueFromDraft()) !== page.savedVenue;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function api(path, init) {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401) {
    location.href = "/host/login?next=" + encodeURIComponent("/host/brand");
    throw new Error("Please sign in again.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const err = new Error(body?.error?.message || "Something went wrong. Try again.");
    /** @type {any} */ (err).problems = body?.error?.problems ?? [];
    throw err;
  }
  return body;
}

async function load() {
  try {
    const [t, v] = await Promise.all([api("/api/theme"), api("/api/venue")]);
    draftFromTheme(t.theme);
    draftFromVenue(v);
    page.savedTheme = JSON.stringify(t.theme);
    page.savedVenue = JSON.stringify(v);
    if (t.problems && t.problems.length > 0) {
      ui.message = { kind: "error", text: "The saved theme file has problems, so Lock-In's look is used until you save again.", problems: t.problems.map((/** @type {any} */ p) => p.message) };
    }
  } catch (e) {
    page.loadError = e instanceof Error ? e.message : String(e);
  }
  page.loading = false;
}

async function saveTheme() {
  ui.saving = true;
  ui.message = null;
  try {
    const { keptEdits } = await saveDraft({
      snapshot: () => JSON.stringify(themeFromDraft()),
      send: (theme) => api("/api/theme", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) }),
      setSaved: (res) => { page.savedTheme = JSON.stringify(res.theme); },
      apply: (res) => draftFromTheme(res.theme),
    });
    ui.message = { kind: "ok", text: keptEdits
      ? "Saved what you had when you pressed Save. Your newer changes are not saved yet."
      : "Saved. The display and phones switch to it from the next screen they show.", problems: [] };
  } catch (e) {
    ui.message = { kind: "error", text: e instanceof Error ? e.message : String(e), problems: (/** @type {any} */ (e).problems ?? []).map((/** @type {any} */ p) => p.message) };
  }
  ui.saving = false;
}

async function saveVenue() {
  ui.saving = true;
  ui.message = null;
  try {
    const { keptEdits } = await saveDraft({
      snapshot: () => JSON.stringify(venueFromDraft()),
      send: (venue) => api("/api/venue", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(venue) }),
      setSaved: (res) => { page.savedVenue = JSON.stringify(res); },
      apply: (res) => draftFromVenue(res),
    });
    ui.message = { kind: "ok", text: keptEdits
      ? "Saved what you had when you pressed Save. Your newer changes are not saved yet."
      : page.tab === "quizzes" ? "Saved. New quizzes start with these." : "Saved. New nights use these settings.", problems: [] };
  } catch (e) {
    ui.message = { kind: "error", text: e instanceof Error ? e.message : String(e), problems: (/** @type {any} */ (e).problems ?? []).map((/** @type {any} */ p) => p.message) };
  }
  ui.saving = false;
}

/**
 * Uploads a picked file and returns its "assets/<name>", or null.
 * @param {Event} e
 * @param {"logo" | "displayBackground" | "poster" | "prize"} kind
 * @param {string} [busy] what ui.uploading says while it runs (a prize row's own key)
 * @returns {Promise<string | null>}
 */
async function upload(e, kind, busy = kind) {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return null;
  ui.uploading = busy;
  ui.message = null;
  try {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    const res = await api("/api/theme/assets", { method: "POST", body: form });
    return res.file;
  } catch (err) {
    ui.message = { kind: "error", text: err instanceof Error ? err.message : String(err), problems: [] };
    return null;
  } finally {
    ui.uploading = "";
  }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const inputs = () => ({
  accent: draft.accent,
  displayBackgroundImage: draft.bgMode === "picture" && draft.bgImage ? assetUrl(draft.bgImage) : null,
});

/** The preview's own clock: a 30 s countdown that starts again every 30 s. */
const preview = reactive({ now: Date.now() });
const LOOP_MS = 30_000;
const previewTimer = () => {
  const start = Math.floor(preview.now / LOOP_MS) * LOOP_MS;
  return { state: /** @type {"running"} */ ("running"), durationMs: LOOP_MS, locksAt: start + LOOP_MS, remainingMs: null };
};

/** The inline custom properties for the preview: the derived venue tokens and the roles that use them. */
function previewStyle() {
  const tokens = deriveBrandTokens(inputs());
  const parts = Object.entries(tokens).map(([k, v]) => "--" + k + ": " + v);
  parts.push("--color-action: var(--venue)", "--color-on-action: var(--on-venue)", "--color-action-tint: var(--venue-tint)",
    "--color-selected: var(--venue)", "--color-correct: var(--venue)", "--color-countdown: var(--venue)");
  return parts.join("; ");
}

const logoSrc = () => (draft.logo ? assetUrl(draft.logo) : "");
const venueName = () => draft.name.trim() || "Your pub";

/** The TV preview: the question screen at 1/4 size. */
function previewDisplay() {
  return html`
  <div class="lockin-preview pv-display" style="${previewStyle}" aria-label="TV preview" role="img">
    <div class="pv-scrim"></div>
    <div class="pv-body">
      <div class="pv-head">
        <img class="${() => (draft.logo ? "pv-logo" : "pv-logo off")}" src="${logoSrc}" alt="">
        <span class="pv-name">${venueName}</span><span class="pv-strip">Round 3 — Space</span>
        <span class="pv-num">04 <span>/ 08</span></span>
      </div>
      <div class="pv-main">
        <div class="pv-q">Which planet in our solar system has the most known moons?
          <div class="pv-bubbles">${[1, 2, 3, 4, 5, 6].map((i) => html`<i style="${"background: var(--team-" + i + ")"}"></i>`)}<i class="w"></i><i class="w"></i></div>
        </div>
        <div class="pv-cd">${countdown(html, { style: () => draft.countdown, timer: previewTimer, now: () => preview.now, size: "tv" })}</div>
      </div>
      <div class="pv-foot"><span class="pv-voice">No phones. Well, one phone.</span><span class="pv-credit">Powered by ${lockup(html, "mono")}</span></div>
    </div>
  </div>`;
}

/** The phone preview: an answer picked, with the countdown and the received strip. */
function previewPhone() {
  return html`
  <div class="lockin-preview pv-phone" style="${previewStyle}" aria-label="Phone preview" role="img">
    <div class="pv-ph-head"><span class="bubble" style="--b: var(--team-1)">QA</span><span class="pv-ph-team">Quizteama Aguilera</span><span class="pv-ph-rq">R3 · 04/08</span></div>
    <div class="pv-ph-cd">${countdown(html, { style: () => draft.countdown, timer: previewTimer, now: () => preview.now, size: "small" })}</div>
    <div class="pv-ph-q">Which planet has the most known moons?</div>
    <div class="pv-ph-opt"><b>A</b>Jupiter</div>
    <div class="pv-ph-opt on"><b>B</b>Saturn</div>
    <div class="pv-ph-opt"><b>C</b>Uranus</div>
    <div class="pv-ph-got"><i></i>The quizmaster has Saturn</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Branding tab
// ---------------------------------------------------------------------------

const badChecks = () => checkReadability(inputs()).filter((c) => c.level !== "ok");

function warnings() {
  // Rows are keyed by their text, so a changed check is a new row (unkeyed rows keep their first text).
  return html`<div class="warn-box" role="status" hidden="${() => badChecks().length === 0}">
    <b>This colour may be hard to read in a pub.</b>
    <ul>${() => badChecks().map((c) => html`<li>${c.message}</li>`.key(c.message))}</ul>
    <span class="hint">You can still save it.</span> <button type="button" class="link" @click="${resetColour}">Reset to Lock-In colours</button>
  </div>`;
}

function resetColour() {
  draft.accent = DEFAULT_INPUTS.accent;
  draft.accentDefault = true;
}

/** @param {string} hex */
function setAccent(hex) {
  draft.accent = hex.toLowerCase();
  draft.accentDefault = draft.accent === DEFAULT_INPUTS.accent;
}

function brandingTab() {
  return html`
  <div class="split">
    <form class="form" @submit="${(/** @type {Event} */ e) => { e.preventDefault(); saveTheme(); }}">
      <div class="field">
        <label for="venue-name">Venue name</label>
        <input id="venue-name" class="input" maxlength="60" spellcheck="true" autocomplete="off" placeholder="The Example Arms" value="${() => draft.name}" @input="${(/** @type {Event} */ e) => { draft.name = /** @type {HTMLInputElement} */ (e.target).value; }}">
        <p class="hint">On the TV, the phones and the phone's app name, and in lines like "Thanks for playing at ${() => draft.name.trim() || "your pub"}".</p>
      </div>

      <div class="field">
        <span class="l">Logo</span>
        <div class="logo-box">
          <div class="logo-thumb">
            <img class="${() => (draft.logo ? "" : "off")}" src="${logoSrc}" alt="Your logo">
            <span class="${() => (draft.logo ? "off" : "logo-mark")}">${mark(html)}</span>
          </div>
          <div class="row">
            <label class="btn small file-btn">${() => (ui.uploading === "logo" ? html`${spinner()}Uploading` : draft.logo ? "Change logo" : "Upload a logo")}
              <input type="file" accept="image/png,image/svg+xml,image/jpeg" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "logo"); if (f) draft.logo = f; }}">
            </label>
            <button type="button" class="btn quiet small" hidden="${() => !draft.logo}" @click="${() => { draft.logo = null; }}">Use the Lock-In mark</button>
          </div>
        </div>
        <p class="hint">PNG, SVG or JPEG, up to 2 MB. A light logo on a transparent background works best.</p>
      </div>

      <div class="field">
        <span class="l">Main colour</span>
        <div class="colour-row">
          <label class="swatch" aria-label="Main colour">
            <input type="color" value="${() => draft.accent}" @input="${(/** @type {Event} */ e) => setAccent(/** @type {HTMLInputElement} */ (e.target).value)}">
          </label>
          <input class="input hex" id="accent-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Colour code"
            value="${() => draft.accent}" @input="${(/** @type {Event} */ e) => { const v = /** @type {HTMLInputElement} */ (e.target).value.trim(); const h = v.startsWith("#") ? v : "#" + v; if (/^#[0-9a-fA-F]{6}$/.test(h)) setAccent(h); }}">
          <span class="hint">${() => (draft.accentDefault ? "Lock-In mint" : "")}</span>
        </div>
        <p class="hint">Any colour: click the square to pick one, or type your brand's colour code (like #c8102e). The dots below are suggestions.</p>
        <div class="suggest" role="group" aria-label="Suggested colours">${SUGGESTED.map((c) => html`
          <button type="button" class="sw" style="${"background:" + c}" aria-label="${"Use " + c}" aria-pressed="${() => String(draft.accent === c)}" @click="${() => setAccent(c)}"></button>`)}
        </div>
        <p class="hint">Buttons, the countdown, the leader and the right answer. Everything else stays Lock-In's, so every pub's night stays readable.</p>
      </div>
      ${warnings()}

      <div class="field">
        <span class="l">Countdown</span>
        <div class="cd-pick" role="radiogroup" aria-label="Countdown style">${COUNTDOWNS.map((c) => html`
          <button type="button" role="radio" aria-checked="${() => String(draft.countdown === c.id)}" @click="${() => { draft.countdown = c.id; }}">
            <span class="${"cd-glyph g-" + c.id}" aria-hidden="true"><i></i><i></i><i></i></span>${c.label}</button>`)}
        </div>
        <p class="hint">How the time left looks on the TV, the phones and here. The last ten seconds turn orange.</p>
      </div>

      <div class="field">
        <span class="l">TV background</span>
        <div class="seg" role="group" aria-label="TV background">
          <button type="button" aria-pressed="${() => String(draft.bgMode === "ink")}" @click="${() => { draft.bgMode = "ink"; }}">Black</button>
          <button type="button" aria-pressed="${() => String(draft.bgMode === "picture")}" @click="${() => { draft.bgMode = "picture"; }}">Picture</button>
        </div>
        <div class="row pic-row" hidden="${() => draft.bgMode !== "picture"}">
          <label class="btn small file-btn">${() => (ui.uploading === "displayBackground" ? html`${spinner()}Uploading` : draft.bgImage ? "Change picture" : "Upload a picture")}
            <input type="file" accept="image/jpeg,image/png,image/webp" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "displayBackground"); if (f) draft.bgImage = f; }}">
          </label>
          <span class="hint">${() => (draft.bgImage ? "It sits under a dark layer so the words stay easy to read." : "JPEG, PNG or WebP, up to 5 MB. Calm pictures work best.")}</span>
        </div>
      </div>

      ${message()}

      <div class="actions">
        <button type="submit" class="btn primary" disabled="${() => ui.saving || !themeDirty()}">${() => (ui.saving ? html`${spinner()}Saving` : "Save")}</button>
        <button type="button" class="btn" disabled="${() => !themeDirty()}" @click="${() => { draftFromTheme(JSON.parse(page.savedTheme)); ui.message = null; }}">Cancel</button>
        <span class="status">${() => (themeDirty() ? "Not saved yet" : "")}</span>
      </div>
    </form>

    <div class="preview-col">
      <p class="label">Preview</p>
      <div class="preview-wrap">
        <figure class="pv-fig">${previewDisplay()}<figcaption class="hint">The TV</figcaption></figure>
        <figure class="pv-fig">${previewPhone()}<figcaption class="hint">A team's phone</figcaption></figure>
      </div>
    </div>
  </div>`;
}

function message() {
  return html`<div class="${() => (ui.message?.kind === "ok" ? "ok-box" : "error-box")}" role="status" hidden="${() => !ui.message}">${() => ui.message?.text ?? ""}
    <ul hidden="${() => !ui.message || ui.message.problems.length === 0}">${() => (ui.message?.problems ?? []).map((p, i) => html`<li>${p}</li>`.key(i + ":" + p))}</ul>
  </div>`;
}

// ---------------------------------------------------------------------------
// Holding page tab (H-17)
// ---------------------------------------------------------------------------

/** @param {number} i @param {number} by */
function movePanel(i, by) {
  const list = venue.panels.map((p) => ({ id: p.id, on: p.on }));
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  if (!a || !b) return;
  list[i] = b;
  list[j] = a;
  venue.panels = list;
}

/** @param {number} i */
function togglePanel(i) {
  venue.panels = venue.panels.map((p, k) => (k === i ? { id: p.id, on: !p.on } : { id: p.id, on: p.on }));
}

function holdingTab() {
  return html`
  <form @submit="${(/** @type {Event} */ e) => { e.preventDefault(); saveVenue(); }}">
    <div class="card">
      <label class="field" for="minutes"><span class="l">Show the holding page from</span></label>
      <div class="row">
        <input id="minutes" class="input short" type="number" min="0" max="120" step="1" inputmode="numeric" value="${() => venue.minutesBefore}" @input="${(/** @type {Event} */ e) => { venue.minutesBefore = /** @type {HTMLInputElement} */ (e.target).value; }}">
        <span>minutes before the planned start</span>
      </div>
      <p class="hint" style="margin-top:6px">Before that, the display shows the plain lobby. Without a planned start time there is no countdown. 0 to 120 minutes.</p>
    </div>
    <div class="card">
      <h2>Panels (they take turns; joining stays on screen)</h2>
      <div class="row panel-time">
        <label for="panel-seconds">Show each panel for</label>
        <input id="panel-seconds" class="input short" type="number" min="5" max="60" step="1" inputmode="numeric" value="${() => venue.panelSeconds}" @input="${(/** @type {Event} */ e) => { venue.panelSeconds = /** @type {HTMLInputElement} */ (e.target).value; }}">
        <span>seconds (5 to 60)</span>
      </div>
      ${() => venue.panels.map((p, i) => html`
        <div class="${p.on ? "panel-row" : "panel-row is-off"}">
          <input type="checkbox" class="switch" id="${"panel-" + p.id}" checked="${p.on}" @change="${() => togglePanel(i)}">
          <label class="name" for="${"panel-" + p.id}">${PANELS.find((x) => x.id === p.id)?.label ?? p.id}</label>
          <button type="button" class="btn ghost small" aria-label="${"Move " + p.id + " up"}" disabled="${i === 0}" @click="${() => movePanel(i, -1)}">↑</button>
          <button type="button" class="btn ghost small" aria-label="${"Move " + p.id + " down"}" disabled="${i === venue.panels.length - 1}" @click="${() => movePanel(i, 1)}">↓</button>
        </div>`.key(p.id))}
      <p class="hint" style="margin-top:8px">Panels that are on are shown in this order.</p>
    </div>
    <div class="card">
      <h2>Poster</h2>
      <div class="row poster-row">
        ${() => (venue.poster ? html`<img class="poster-thumb" src="${assetUrl(venue.poster)}" alt="Your poster">` : html`<span class="poster-thumb none">No poster</span>`)}
        <label class="btn small file-btn">${() => (ui.uploading === "poster" ? html`${spinner()}Uploading` : venue.poster ? "Change poster" : "Upload a poster")}
          <input type="file" id="poster-file" accept="image/jpeg,image/png,image/webp" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "poster"); if (f) venue.poster = f; }}">
        </label>
        <button type="button" class="btn ghost small" hidden="${() => !venue.poster}" @click="${() => { venue.poster = null; }}">Remove</button>
      </div>
      <p class="hint" style="margin-top:6px">Shown in the Poster panel, for example a "Live music on Thursday" poster. Without one, the panel shows the Lock-In mark and a tagline. JPEG, PNG or WebP, up to 5 MB.</p>
    </div>
    <div class="card">
      <h2>After the winner</h2>
      <div class="row">
        <input type="radio" id="after-timer" name="after" checked="${() => venue.afterMode === "timer"}" @change="${() => { venue.afterMode = "timer"; }}">
        <label for="after-timer">Show the final standings after</label>
        <input id="after-seconds" class="input short" type="number" min="5" max="120" step="1" inputmode="numeric" aria-label="Seconds" value="${() => venue.afterSeconds}" disabled="${() => venue.afterMode !== "timer"}" @input="${(/** @type {Event} */ e) => { venue.afterSeconds = /** @type {HTMLInputElement} */ (e.target).value; }}">
        <span>seconds</span>
      </div>
      <div class="row" style="margin-top:6px">
        <input type="radio" id="after-host" name="after" checked="${() => venue.afterMode === "host"}" @change="${() => { venue.afterMode = "host"; }}">
        <label for="after-host">Wait until I press Next on the host screen</label>
      </div>
      <p class="hint" style="margin-top:6px">At Quiz End the display shows the winner, then the final standings. 5 to 120 seconds. You can press Next early either way.</p>
    </div>
    ${message()}
    ${venueActions()}
  </form>`;
}

function venueActions() {
  return html`<div class="actions">
    <button type="submit" class="btn primary" disabled="${() => ui.saving || !venueDirty()}">${() => (ui.saving ? html`${spinner()}Saving` : "Save")}</button>
    <button type="button" class="btn ghost" disabled="${() => !venueDirty()}" @click="${() => { draftFromVenue(JSON.parse(page.savedVenue)); ui.message = null; }}">Cancel</button>
    <span class="status">${() => (venueDirty() ? "Not saved yet" : "")}</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Quiz defaults tab (UI-33, Cas 2026-11-27): what a new quiz starts with. Quizzes that
// exist keep their own settings; each quiz can still change any of these in its Settings tab.
// ---------------------------------------------------------------------------

/**
 * @param {string} label @param {[string, string][]} options
 * @param {() => string} get @param {(v: string) => void} set
 */
const seg = (label, options, get, set) => html`
  <div class="seg" role="radiogroup" aria-label="${label}">
    ${options.map(([v, text]) => html`<button type="button" role="radio" aria-checked="${() => (get() === v ? "true" : "false")}"
      @click="${() => set(v)}">${text}</button>`)}
  </div>`;

/** The default round count as a number (6 while the box is mid-edit). */
const qdRoundCount = () => { const n = Math.round(Number(venue.qdRounds)); return n >= 1 && n <= 20 ? n : 6; };

/**
 * A short number input with its unit, in the two-column card layout.
 * @param {string} id @param {string} label @param {"qdRounds" | "qdQuestions" | "qdTimer" | "qdTeams" | "qdSdMax"} key
 * @param {number} min @param {number} max @param {string} unit @param {string} hint @param {number} [step]
 */
const numberField = (id, label, key, min, max, unit, hint, step = 1) => html`
  <div class="field"><label class="l" for="${id}">${label}</label>
    <div class="ctl"><div class="unit"><input id="${id}" class="input short" type="number" min="${String(min)}" max="${String(max)}" step="${String(step)}" inputmode="numeric"
      value="${() => venue[key]}" @input="${(/** @type {Event} */ e) => { venue[key] = /** @type {HTMLInputElement} */ (e.target).value; }}"><span>${unit}</span></div>
    <p class="hint">${hint}</p></div></div>`;

function quizDefaultsTab() {
  return html`
  <form @submit="${(/** @type {Event} */ e) => { e.preventDefault(); saveVenue(); }}">
    <p class="hint tab-intro">A new quiz starts with these. Quizzes you already have keep their own, and every quiz can change them in its Settings tab.</p>
    <section class="card form-card cols">
      <h2>A new quiz</h2>
      ${numberField("qd-rounds", "Rounds", "qdRounds", 1, 20, "rounds", "1 to 20. You can add or remove rounds in the quiz.")}
      ${numberField("qd-questions", "Questions in each round", "qdQuestions", 1, 30, "questions", "1 to 30.")}
    </section>
    <section class="card form-card cols">
      <h2>Answers</h2>
      <div class="field"><span class="l">Lock answers</span>
        <div class="ctl">${seg("Lock answers", [["question", "After each question"], ["round", "At the end of each round"]], () => venue.qdLock, (v) => { venue.qdLock = /** @type {any} */ (v); })}</div></div>
      ${numberField("qd-timer", "Timer per question", "qdTimer", 10, 300, "seconds", "10 to 300. A question can set its own.", 5)}
    </section>
    <section class="card form-card cols">
      <h2>Rounds and teams</h2>
      <div class="field"><label class="l" for="qd-half">Halftime</label>
        <div class="ctl"><select id="qd-half" class="input narrow" @change="${(/** @type {Event} */ e) => { venue.qdHalf = /** @type {HTMLSelectElement} */ (e.target).value; }}">
          <option value="auto" selected="${() => venue.qdHalf === "auto"}">${() => `Halfway (after round ${Math.ceil(qdRoundCount() / 2)})`}</option>
          <option value="none" selected="${() => venue.qdHalf === "none"}">No halftime</option>
          ${Array.from({ length: 19 }, (_, i) => String(i + 1)).map((n) => html`<option value="${n}" hidden="${() => Number(n) >= qdRoundCount()}" selected="${() => venue.qdHalf === n}">After round ${n}</option>`)}
        </select>
        <p class="hint">Halfway follows each quiz's own round count. A quiz can change it in its Settings.</p></div></div>
      <div class="field"><span class="l">Joker</span>
        <div class="ctl">${seg("Joker", [["false", "Off"], ["true", "On"]], () => String(venue.qdJoker), (v) => { venue.qdJoker = v === "true"; })}
        <p class="hint">Each team picks one round to score double.</p></div></div>
      ${numberField("qd-teams", "Most teams", "qdTeams", 2, 30, "teams", "2 to 30.")}
    </section>
    <section class="card form-card cols">
      <h2>Ties and closest numbers</h2>
      <div class="field"><span class="l">Closest-number scoring</span>
        <div class="ctl">${seg("Closest-number scoring", [["closest", "Closest team wins"], ["range", "Everyone within range"]], () => venue.qdClosest, (v) => { venue.qdClosest = /** @type {any} */ (v); })}</div></div>
      <div class="field"><span class="l">Sudden death decides</span>
        <div class="ctl">${seg("Sudden death decides", [["first", "First place only"], ["all", "Every tied place"]], () => venue.qdScope, (v) => { venue.qdScope = /** @type {any} */ (v); })}</div></div>
      ${numberField("qd-sdmax", "Sudden-death questions", "qdSdMax", 1, 10, "per place, at most", "1 to 10. After that the place is shared.")}
    </section>
    ${message()}
    ${venueActions()}
  </form>`;
}

// ---------------------------------------------------------------------------
// Prizes tab (H-15 venue defaults)
// ---------------------------------------------------------------------------

function addPrize() {
  let next = 1;
  for (const p of venue.prizes) next = Math.max(next, (Number(p.place) || 0) + 1);
  venue.prizes = [...venue.prizes.map((p) => ({ ...p })), { key: prizeKey++, place: String(next), text: "", image: null }];
}

/** @param {number} key @param {"place" | "text"} field @param {string} value */
function setPrize(key, field, value) {
  const p = venue.prizes.find((x) => x.key === key);
  if (p) p[field] = value;
}

function prizesTab() {
  return html`
  <form @submit="${(/** @type {Event} */ e) => { e.preventDefault(); saveVenue(); }}">
    <div class="card prize-card">
      <h2>Default prizes for new nights</h2>
      <p class="hint" style="margin-bottom:12px">These fill in "Prizes tonight" when you open a night, where you can change them for that night only. They show on the display and phones in the lobby, at halftime and at the end. A prize can have a picture (JPEG, PNG or WebP, up to 5 MB).</p>
      ${() => (venue.prizes.length === 0 ? html`<p class="hint">No prizes yet.</p>` : "")}
      ${() => venue.prizes.map((p) => html`
        <div class="prize-row">
          <input class="input" type="number" min="1" step="1" aria-label="Place" value="${p.place}" @input="${(/** @type {Event} */ e) => setPrize(p.key, "place", /** @type {HTMLInputElement} */ (e.target).value)}">
          <input class="input" maxlength="80" spellcheck="true" placeholder="For example: R300 bar tab" aria-label="${"Prize for place " + p.place}" value="${p.text}" @input="${(/** @type {Event} */ e) => setPrize(p.key, "text", /** @type {HTMLInputElement} */ (e.target).value)}">
          <span class="prize-pic">
            <img class="prize-thumb" alt="" hidden="${() => !p.image}" src="${() => (p.image ? assetUrl(p.image) : "")}">
            <label class="btn ghost small file-btn">${() => (ui.uploading === `prize-${p.key}` ? html`${spinner()}Uploading` : p.image ? "Change picture" : "Add a picture")}
              <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="${"Picture for place " + p.place}" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "prize", `prize-${p.key}`); if (f) p.image = f; }}">
            </label>
            <button type="button" class="link" hidden="${() => !p.image}" @click="${() => { p.image = null; }}">Remove picture</button>
          </span>
          <button type="button" class="btn ghost small" @click="${() => { venue.prizes = venue.prizes.filter((x) => x.key !== p.key).map((x) => ({ ...x })); }}">Remove prize</button>
        </div>`.key(p.key))}
      <button type="button" class="btn ghost small" @click="${addPrize}">Add a prize</button>
    </div>
    ${message()}
    ${venueActions()}
  </form>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function tabFromHash() {
  const h = location.hash.slice(1);
  return /** @type {Tab} */ (TABS.some((t) => t.id === h) ? h : "branding");
}

/**
 * All three tabs are built once and shown or hidden (UI-18). Swapping one tab's template for
 * another in the same slot broke in Arrow 1.0.6 ("getNode(...).after is not a function" going
 * from Holding page to Prizes), which left the Prizes tab blank.
 */
function allTabs() {
  return html`<div hidden="${() => page.tab !== "branding"}">${brandingTab()}</div>
    <div hidden="${() => page.tab !== "holding"}">${holdingTab()}</div>
    <div hidden="${() => page.tab !== "prizes"}">${prizesTab()}</div>
    <div hidden="${() => page.tab !== "quizzes"}">${quizDefaultsTab()}</div>
    <div hidden="${() => page.tab !== "displays"}">${displaysTab()}</div>`;
}

// ---------------------------------------------------------------------------
// Displays tab: the TVs paired with this server (Cas, 2026-11-26). Pairing lasts across
// nights, so it is a venue setting; Run night keeps the same card for pairing on the spot.
// ---------------------------------------------------------------------------

function displaysTab() {
  return html`<div>
    <p class="hint tab-intro">A paired display stays paired across nights and restarts, until you unpair it. You can also pair one from Run night.</p>
    <div class="error-box" role="alert" hidden="${() => !hostUi.error}">${() => hostUi.error}</div>
    <div hidden="${() => hostPage.status !== "connecting"}">${loading("Connecting to Lock-In")}</div>
    <p class="hint busy-line" hidden="${() => hostPage.status !== "offline"}">${spinner()}Not connected to Lock-In. Trying again.</p>
    ${pairCard()}
  </div>`;
}

/** The host socket the Displays tab uses: the server's view carries the paired displays. */
const hostClient = /** @type {any} */ (window).LockIn.connect({
  role: "host",
  onState(/** @type {any} */ v) { hostPage.view = v; },
  onStatus(/** @type {string} */ status) { hostPage.status = status; },
  onBye(/** @type {string} */ reason) {
    if (reason === "signed_out") location.href = "/host/login?next=/host/brand";
  },
});
setClient(hostClient);

/** @param {Tab} id */
function showTab(id) {
  page.tab = id;
  ui.message = null;
  history.replaceState(null, "", "#" + id);
}

const view = html`
<div class="brand-page">
  <div class="page-head">
    <h1>Venue settings</h1>
    <div class="seg" role="tablist" aria-label="Venue settings">${TABS.map((t) => html`
      <button type="button" role="tab" aria-selected="${() => String(page.tab === t.id)}" @click="${() => showTab(t.id)}">${t.label}</button>`)}
    </div>
  </div>
  ${() => page.loading
    ? loading("Loading the venue settings")
    : page.loadError
      ? html`<div class="error-box">${page.loadError}</div>`
      : html`<div class="tabs">${allTabs()}</div>`}
</div>`;

const main = document.getElementById("host-main");
if (main) {
  main.textContent = "";
  view(main);
}

window.addEventListener("hashchange", () => { page.tab = tabFromHash(); ui.message = null; });
// Unsaved edits: the design system's dialog for links, the browser's prompt on reload (UI-16).
/** @type {any} */ (window).LockIn.nav.guardUnsaved(() => themeDirty() || venueDirty());

// The preview's countdown runs on its own, a 30 s loop, so the style can be seen moving.
setInterval(() => { preview.now = Date.now(); }, 250);

load();
