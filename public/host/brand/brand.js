// @ts-check
// Branding and venue settings (B4): H-15 venue defaults (prizes), H-16 branding
// with a live preview and readability warnings, H-17 holding page settings.
// Last Call (docs/DESIGN-SYSTEM.md, "Venue branding"): a venue sets its name, logo, ONE
// main colour, the countdown style and the TV picture. Everything else stays Lock In's.
// Built with Arrow (TECH-SPEC 3.4): the saved settings and the unsaved draft
// live in separate reactive stores; the preview and the warnings read the draft,
// so they change as the QM types, and nothing is written until Save.

import { html, reactive } from "/vendor/arrow/index.mjs";
import { saveDraft } from "./save.js";
import { DEFAULT_INPUTS, checkReadability, deriveBrandTokens, assetUrl } from "./derive.js";
import { countdown } from "/static/shared/countdown.mjs";
import { lockup, mark } from "/static/shared/mark.mjs";

/** @typedef {import('../../../src/shared/formats').ThemeFile} ThemeFile */
/** @typedef {import('../../../src/shared/formats').VenueFile} VenueFile */
/** @typedef {import('../../../src/shared/formats').HoldingPanel} HoldingPanel */
/** @typedef {import('../../../src/shared/formats').CountdownStyle} CountdownStyle */
/** @typedef {"branding" | "holding" | "prizes"} Tab */

/** @type {{ id: Tab, label: string }[]} */
const TABS = [
  { id: "branding", label: "Branding" },
  { id: "holding", label: "Holding page" },
  { id: "prizes", label: "Prizes" },
];

/** @type {{ id: HoldingPanel, label: string }[]} */
const PANELS = [
  { id: "countdown", label: "Countdown to the start" },
  { id: "teams", label: "Teams that have joined" },
  { id: "join", label: "How to join" },
  { id: "install", label: "Put the quiz on your home screen" },
  { id: "animation", label: "Brand animation" },
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

/** A few colours that work well, for a quick pick. Mint is Lock In's own. */
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
  /** true while the colour is still Lock In's default, so saving keeps it null */
  accentDefault: true,
  /** @type {CountdownStyle} */
  countdown: "ring",
  /** @type {"ink" | "picture"} */
  bgMode: "ink",
  bgImage: /** @type {string | null} */ (null),
});

/** Unsaved venue settings. */
const venue = reactive({
  minutesBefore: "30",
  /** every panel, in order, with on/off */
  panels: PANELS.map((p) => ({ id: p.id, on: true })),
  /** @type {{ key: number, place: string, text: string }[]} */
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
  const on = v.holding.panels;
  venue.panels = [
    ...on.map((id) => ({ id, on: true })),
    ...PANELS.filter((p) => !on.includes(p.id)).map((p) => ({ id: p.id, on: false })),
  ];
  venue.prizes = v.prizes.map((p) => ({ key: prizeKey++, place: String(p.place), text: p.text }));
  venue.afterMode = v.afterWinner.mode;
  venue.afterSeconds = String(v.afterWinner.seconds);
}

/** @returns {unknown} sent as typed; the server validates it */
function venueFromDraft() {
  const minutes = Number(venue.minutesBefore);
  const seconds = Number(venue.afterSeconds);
  return {
    format: "lockin.venue/1",
    prizes: venue.prizes.map((p) => ({ place: Number(p.place), text: p.text.trim() })),
    holding: {
      minutesBefore: venue.minutesBefore.trim() === "" || !Number.isFinite(minutes) ? venue.minutesBefore : minutes,
      panels: venue.panels.filter((p) => p.on).map((p) => p.id),
    },
    afterWinner: {
      mode: venue.afterMode,
      seconds: venue.afterSeconds.trim() === "" || !Number.isFinite(seconds) ? venue.afterSeconds : seconds,
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
      : "Saved. New nights use these settings.", problems: [] };
  } catch (e) {
    ui.message = { kind: "error", text: e instanceof Error ? e.message : String(e), problems: (/** @type {any} */ (e).problems ?? []).map((/** @type {any} */ p) => p.message) };
  }
  ui.saving = false;
}

/**
 * Uploads a picked file and returns its "assets/<name>", or null.
 * @param {Event} e
 * @param {"logo" | "displayBackground"} kind
 * @returns {Promise<string | null>}
 */
async function upload(e, kind) {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return null;
  ui.uploading = kind;
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
    <span class="hint">You can still save it.</span> <button type="button" class="link" @click="${resetColour}">Reset to Lock In colours</button>
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
            <label class="btn small file-btn">${() => (ui.uploading === "logo" ? "Uploading…" : draft.logo ? "Change logo" : "Upload a logo")}
              <input type="file" accept="image/png,image/svg+xml,image/jpeg" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "logo"); if (f) draft.logo = f; }}">
            </label>
            <button type="button" class="btn quiet small" hidden="${() => !draft.logo}" @click="${() => { draft.logo = null; }}">Use the lock in mark</button>
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
          <span class="hex">${() => draft.accent}</span>
          <span class="hint">${() => (draft.accentDefault ? "Lock In mint" : "")}</span>
        </div>
        <div class="suggest" role="group" aria-label="Suggested colours">${SUGGESTED.map((c) => html`
          <button type="button" class="sw" style="${"background:" + c}" aria-label="${"Use " + c}" aria-pressed="${() => String(draft.accent === c)}" @click="${() => setAccent(c)}"></button>`)}
        </div>
        <p class="hint">Buttons, the countdown, the leader and the right answer. Everything else stays Lock In's, so every pub's night stays readable.</p>
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
          <label class="btn small file-btn">${() => (ui.uploading === "displayBackground" ? "Uploading…" : draft.bgImage ? "Change picture" : "Upload a picture")}
            <input type="file" accept="image/jpeg,image/png,image/webp" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "displayBackground"); if (f) draft.bgImage = f; }}">
          </label>
          <span class="hint">${() => (draft.bgImage ? "It sits under a dark layer so the words stay easy to read." : "JPEG, PNG or WebP, up to 5 MB. Calm pictures work best.")}</span>
        </div>
      </div>

      ${message()}

      <div class="actions">
        <button type="submit" class="btn primary" disabled="${() => ui.saving || !themeDirty()}">${() => (ui.saving ? "Saving…" : "Save")}</button>
        <button type="button" class="btn" disabled="${() => !themeDirty()}" @click="${() => { draftFromTheme(JSON.parse(page.savedTheme)); ui.message = null; }}">Cancel</button>
        <span class="status">${() => (themeDirty() ? "Not saved yet" : "")}</span>
      </div>
    </form>

    <div class="preview-col">
      <p class="label">Preview</p>
      <div class="preview-wrap">${previewDisplay()}${previewPhone()}</div>
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
      <h2>Panels (they take turns, 12 seconds each; joining stays on screen)</h2>
      ${() => venue.panels.map((p, i) => html`
        <div class="${p.on ? "panel-row" : "panel-row off"}">
          <input type="checkbox" class="switch" id="${"panel-" + p.id}" checked="${p.on}" @change="${() => togglePanel(i)}">
          <label class="name" for="${"panel-" + p.id}">${PANELS.find((x) => x.id === p.id)?.label ?? p.id}</label>
          <button type="button" class="btn ghost small" aria-label="${"Move " + p.id + " up"}" disabled="${i === 0}" @click="${() => movePanel(i, -1)}">↑</button>
          <button type="button" class="btn ghost small" aria-label="${"Move " + p.id + " down"}" disabled="${i === venue.panels.length - 1}" @click="${() => movePanel(i, 1)}">↓</button>
        </div>`.key(p.id))}
      <p class="hint" style="margin-top:8px">Panels that are on are shown in this order.</p>
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
    <button type="submit" class="btn primary" disabled="${() => ui.saving || !venueDirty()}">${() => (ui.saving ? "Saving…" : "Save")}</button>
    <button type="button" class="btn ghost" disabled="${() => !venueDirty()}" @click="${() => { draftFromVenue(JSON.parse(page.savedVenue)); ui.message = null; }}">Cancel</button>
    <span class="status">${() => (venueDirty() ? "Not saved yet" : "")}</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Prizes tab (H-15 venue defaults)
// ---------------------------------------------------------------------------

function addPrize() {
  let next = 1;
  for (const p of venue.prizes) next = Math.max(next, (Number(p.place) || 0) + 1);
  venue.prizes = [...venue.prizes.map((p) => ({ ...p })), { key: prizeKey++, place: String(next), text: "" }];
}

/** @param {number} key @param {"place" | "text"} field @param {string} value */
function setPrize(key, field, value) {
  const p = venue.prizes.find((x) => x.key === key);
  if (p) p[field] = value;
}

function prizesTab() {
  return html`
  <form @submit="${(/** @type {Event} */ e) => { e.preventDefault(); saveVenue(); }}">
    <div class="card">
      <h2>Default prizes for new nights</h2>
      <p class="hint" style="margin-bottom:12px">The host can still change them for a night in the lobby. They show on the display and phones in the lobby, at halftime and at the end.</p>
      ${() => (venue.prizes.length === 0 ? html`<p class="hint">No prizes yet.</p>` : "")}
      ${() => venue.prizes.map((p) => html`
        <div class="prize-row">
          <input class="input" type="number" min="1" step="1" aria-label="Place" value="${p.place}" @input="${(/** @type {Event} */ e) => setPrize(p.key, "place", /** @type {HTMLInputElement} */ (e.target).value)}">
          <input class="input" maxlength="80" spellcheck="true" placeholder="For example: R300 bar tab" aria-label="${"Prize for place " + p.place}" value="${p.text}" @input="${(/** @type {Event} */ e) => setPrize(p.key, "text", /** @type {HTMLInputElement} */ (e.target).value)}">
          <button type="button" class="btn ghost small" @click="${() => { venue.prizes = venue.prizes.filter((x) => x.key !== p.key).map((x) => ({ ...x })); }}">Remove</button>
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

/** @param {Tab} id */
function showTab(id) {
  page.tab = id;
  ui.message = null;
  history.replaceState(null, "", "#" + id);
}

const view = html`
<div class="brand-page">
  <div class="brand-head">
    <h1>Venue settings</h1>
    <div class="seg" role="tablist" aria-label="Venue settings">${TABS.map((t) => html`
      <button type="button" role="tab" aria-selected="${() => String(page.tab === t.id)}" @click="${() => showTab(t.id)}">${t.label}</button>`)}
    </div>
  </div>
  ${() => page.loading
    ? html`<p class="placeholder">Loading the venue settings…</p>`
    : page.loadError
      ? html`<div class="error-box">${page.loadError}</div>`
      : page.tab === "branding" ? brandingTab() : page.tab === "holding" ? holdingTab() : prizesTab()}
</div>`;

const main = document.getElementById("host-main");
if (main) {
  main.textContent = "";
  view(main);
}

window.addEventListener("hashchange", () => { page.tab = tabFromHash(); ui.message = null; });
window.addEventListener("beforeunload", (e) => {
  if (themeDirty() || venueDirty()) e.preventDefault();
});

// The preview's countdown runs on its own, a 30 s loop, so the style can be seen moving.
setInterval(() => { preview.now = Date.now(); }, 250);

load();
