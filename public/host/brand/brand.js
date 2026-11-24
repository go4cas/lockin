// @ts-check
// Branding and venue settings (B4): H-15 venue defaults (prizes), H-16 branding
// with a live preview and readability warnings, H-17 holding page settings.
// Built with Arrow (TECH-SPEC 3.4): the saved settings and the unsaved draft
// live in separate reactive stores; the preview and the warnings read the draft,
// so they change as the QM types, and nothing is written until Save.

import { html, reactive, watch } from "/vendor/arrow/index.mjs";
import { BUNDLED_FONT_INFO, DEFAULT_INPUTS, checkReadability, deriveBrandTokens, assetUrl, DISPLAY_FALLBACK, BODY_FALLBACK } from "./derive.js";

/** @typedef {import('../../../src/shared/formats').ThemeFile} ThemeFile */
/** @typedef {import('../../../src/shared/formats').VenueFile} VenueFile */
/** @typedef {import('../../../src/shared/formats').HoldingPanel} HoldingPanel */
/** @typedef {import('../../../src/shared/formats').FontRef} FontRef */
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

/** "Aim for" ratios of the checks (docs/design/branding.md, "Readability warnings"). */
/** @type {Record<string, number>} */
const AIM = {
  "Text on background": 7, "Text on panels": 7, "Main colour on background": 3,
  "Second colour on background": 3, "Button text on main colour": 4.5, "Labels on second colour": 4.5,
};

const COLOURS = /** @type {const} */ ([
  ["background", "Background"], ["text", "Text"], ["accent", "Main"], ["accent2", "Second"],
]);

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
  background: DEFAULT_INPUTS.background,
  text: DEFAULT_INPUTS.text,
  accent: DEFAULT_INPUTS.accent,
  accent2: DEFAULT_INPUTS.accent2,
  /** true while a colour is still Lock-In's default, so saving keeps it null */
  coloursDefault: { background: true, text: true, accent: true, accent2: true },
  displayFont: "caveat-brush",
  displayFontFile: /** @type {string | null} */ (null),
  bodyFont: "atkinson-hyperlegible",
  bodyFontFile: /** @type {string | null} */ (null),
  /** @type {"colour" | "picture"} */
  bgMode: "colour",
  bgColour: /** @type {string | null} */ (null),
  bgImage: /** @type {string | null} */ (null),
});

/** Unsaved venue settings. */
const venue = reactive({
  minutesBefore: "30",
  /** every panel, in order, with on/off */
  panels: PANELS.map((p) => ({ id: p.id, on: true })),
  /** @type {{ key: number, place: string, text: string }[]} */
  prizes: [],
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
  for (const [k] of COLOURS) {
    const v = t.colours[k];
    draft[k] = v ?? DEFAULT_INPUTS[k];
    draft.coloursDefault[k] = v === null;
  }
  const d = t.fonts.display, b = t.fonts.body;
  draft.displayFont = d && "file" in d ? "upload" : d ? d.bundled : "caveat-brush";
  draft.displayFontFile = d && "file" in d ? d.file : null;
  draft.bodyFont = b && "file" in b ? "upload" : "atkinson-hyperlegible";
  draft.bodyFontFile = b && "file" in b ? b.file : null;
  const bg = t.displayBackground;
  draft.bgMode = bg && "image" in bg ? "picture" : "colour";
  draft.bgColour = bg && "colour" in bg ? bg.colour : null;
  draft.bgImage = bg && "image" in bg ? bg.image : null;
  page.copy = t.copy;
}

/** @returns {ThemeFile} */
function themeFromDraft() {
  const name = draft.name.trim();
  /** @param {"display" | "body"} role @returns {FontRef | null} */
  const font = (role) => {
    const id = role === "display" ? draft.displayFont : draft.bodyFont;
    const file = role === "display" ? draft.displayFontFile : draft.bodyFontFile;
    if (id === "upload") return file ? { file } : null;
    const dflt = role === "display" ? "caveat-brush" : "atkinson-hyperlegible";
    return id === dflt ? null : { bundled: id };
  };
  /** @param {"background" | "text" | "accent" | "accent2"} k */
  const colour = (k) => (draft.coloursDefault[k] ? null : draft[k]);
  return {
    format: "lockin.theme/1",
    name: name === "" ? null : name,
    logo: draft.logo,
    colours: { background: colour("background"), text: colour("text"), accent: colour("accent"), accent2: colour("accent2") },
    fonts: { display: font("display"), body: font("body") },
    displayBackground: draft.bgMode === "picture"
      ? (draft.bgImage ? { image: draft.bgImage } : null)
      : (draft.bgColour ? { colour: draft.bgColour } : null),
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
}

/** @returns {unknown} sent as typed; the server validates it */
function venueFromDraft() {
  const minutes = Number(venue.minutesBefore);
  return {
    format: "lockin.venue/1",
    prizes: venue.prizes.map((p) => ({ place: Number(p.place), text: p.text.trim() })),
    holding: {
      minutesBefore: venue.minutesBefore.trim() === "" || !Number.isFinite(minutes) ? venue.minutesBefore : minutes,
      panels: venue.panels.filter((p) => p.on).map((p) => p.id),
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
    const res = await api("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeFromDraft() }),
    });
    draftFromTheme(res.theme);
    page.savedTheme = JSON.stringify(res.theme);
    ui.message = { kind: "ok", text: "Saved. The display and phones switch to it from the next screen they show.", problems: [] };
  } catch (e) {
    ui.message = { kind: "error", text: e instanceof Error ? e.message : String(e), problems: (/** @type {any} */ (e).problems ?? []).map((/** @type {any} */ p) => p.message) };
  }
  ui.saving = false;
}

async function saveVenue() {
  ui.saving = true;
  ui.message = null;
  try {
    const res = await api("/api/venue", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(venueFromDraft()),
    });
    draftFromVenue(res);
    page.savedVenue = JSON.stringify(res);
    ui.message = { kind: "ok", text: "Saved. New nights use these settings.", problems: [] };
  } catch (e) {
    ui.message = { kind: "error", text: e instanceof Error ? e.message : String(e), problems: (/** @type {any} */ (e).problems ?? []).map((/** @type {any} */ p) => p.message) };
  }
  ui.saving = false;
}

/**
 * Uploads a picked file and returns its "assets/<name>", or null.
 * @param {Event} e
 * @param {"logo" | "displayBackground" | "font"} kind
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
  background: draft.background,
  text: draft.text,
  accent: draft.accent,
  accent2: draft.accent2,
  displayBackgroundColour: draft.bgMode === "colour" ? draft.bgColour : null,
  displayBackgroundImage: draft.bgMode === "picture" && draft.bgImage ? assetUrl(draft.bgImage) : null,
});

/** @param {string} id */
const familyOf = (id) => (BUNDLED_FONT_INFO.find((f) => f.id === id) || BUNDLED_FONT_INFO[3])?.family ?? "Atkinson Hyperlegible";

/** The inline custom properties for the preview: the derived colours and the fonts. */
function previewStyle() {
  const tokens = deriveBrandTokens(inputs());
  const display = draft.displayFont === "upload"
    ? (draft.displayFontFile ? '"Lock-In Preview Display", ' + DISPLAY_FALLBACK : "")
    : '"' + familyOf(draft.displayFont) + '", ' + DISPLAY_FALLBACK;
  const body = draft.bodyFont === "upload"
    ? (draft.bodyFontFile ? '"Lock-In Preview Body", ' + BODY_FALLBACK : "")
    : '"Atkinson Hyperlegible", ' + BODY_FALLBACK;
  const parts = Object.entries(tokens).map(([k, v]) => "--" + k + ": " + v);
  if (display) parts.push("--brand-font-display: " + display);
  if (body) parts.push("--brand-font-body: " + body);
  return parts.join("; ");
}

/**
 * Uploaded fonts need @font-face rules; the server writes them, scoped to the
 * preview, in /api/theme/preview.css. Only fonts change this link.
 */
let previewCssHref = "";
function syncPreviewFonts() {
  const fonts = themeFromDraft().fonts;
  const uploaded = (fonts.display && "file" in fonts.display) || (fonts.body && "file" in fonts.body);
  const href = uploaded
    ? "/api/theme/preview.css?theme=" + encodeURIComponent(JSON.stringify({ format: "lockin.theme/1", fonts }))
    : "";
  if (href === previewCssHref) return;
  previewCssHref = href;
  let link = /** @type {HTMLLinkElement | null} */ (document.getElementById("preview-css"));
  if (!href) { link?.remove(); return; }
  if (!link) {
    link = document.createElement("link");
    link.id = "preview-css";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = href;
}

const logoSrc = () => (draft.logo ? assetUrl(draft.logo) : "/static/logo/lockin-mark.svg");
const sampleTeams = ["Quizteama Aguilera", "The Usual Suspects", "Les Quizerables", "Agatha Quiztie", "Universally Challenged", "Tequila Mockingbird"];

/** A sample line in the venue's voice; {pub} lines need a name, so this one is fixed. */
const sampleLine = "Grab a drink. Pick a silly name.";

function previewDisplay() {
  return html`
  <div class="lockin-preview pv-display" style="${previewStyle}" aria-label="Display preview" role="img">
    <div class="pv-bgimg"></div><div class="pv-scrim"></div>
    <div class="pv-body">
      <div class="pv-head"><img src="${logoSrc}" alt=""><span>${() => draft.name.trim()}</span><span class="soon">Starting soon</span></div>
      <div class="pv-main">
        <div>
          <div class="pv-qr"><i></i></div>
          <div class="pv-addr">Scan, or go to quiz.example.com</div>
          <div class="pv-label" style="margin-top:6px">Room code</div>
          <div class="pv-code">KXBT</div>
        </div>
        <div>
          <p class="pv-line">${sampleLine}</p>
          <div class="pv-label">6 teams in</div>
          <div class="pv-chips">${sampleTeams.map((n, i) => html`<span class="pv-chip"><i style="${"background: var(--team-" + (i + 1) + ")"}"></i>${n}</span>`)}</div>
          <div class="pv-prizes"><span>Tonight's prizes</span>${() => previewPrizes().map((p) => html`<span><b>${ordinal(p.place)}</b> ${p.text}</span>`.key(p.place + ":" + p.text))}</div>
        </div>
      </div>
      <div class="pv-flash">Tequila Mockingbird just joined. Fresh legs.</div>
    </div>
    <div class="pv-credit">Powered by Lock-In</div>
  </div>`;
}

function previewPhone() {
  return html`
  <div class="lockin-preview pv-phone" style="${previewStyle}" aria-label="Phone preview" role="img">
    <div class="pv-head"><img src="${logoSrc}" alt=""><span>${() => draft.name.trim()}</span></div>
    <div class="pv-card"><div class="pv-muted">The quiz starts in</div><div class="pv-count">12:34</div><div class="pv-muted">6 teams ready</div></div>
    <p class="pv-line">${sampleLine}</p>
    <div class="pv-card"><div class="pv-label">Tonight's prizes</div>${() => previewPrizes().map((p) => html`<div class="pv-prize"><b>${ordinal(p.place)}</b>${p.text}</div>`.key(p.place + ":" + p.text))}</div>
    <div class="pv-btn">Put the quiz on your home screen</div>
    <div class="pv-credit">Powered by Lock-In</div>
  </div>`;
}

/** Prizes for the preview: the venue's, or a made-up sample. */
function previewPrizes() {
  const real = venue.prizes.filter((p) => p.text.trim() !== "" && Number(p.place) >= 1).slice(0, 3);
  return real.length > 0 ? real.map((p) => ({ place: Number(p.place), text: p.text })) : [{ place: 1, text: "Bar tab" }, { place: 2, text: "A round of shots" }];
}

// ---------------------------------------------------------------------------
// Branding tab
// ---------------------------------------------------------------------------

const badChecks = () => checkReadability(inputs()).filter((c) => c.level !== "ok");

/** @param {import("./derive.js").ContrastCheck} c */
const warningText = (c) => c.message + (AIM[c.pair] ? " (" + c.ratio + " : 1, aim for " + AIM[c.pair] + " : 1)" : "");

function warnings() {
  // Rows are keyed by their text, so a changed ratio is a new row (unkeyed rows keep their first text).
  return html`<div class="ok-box" hidden="${() => badChecks().length > 0}">These colours read well in a pub.</div>
  <div class="warn-box" role="status" hidden="${() => badChecks().length === 0}">
    <b>This may be hard to read in a pub.</b>
    <ul>${() => badChecks().map((c) => html`<li>${warningText(c)}</li>`.key(warningText(c)))}</ul>
    <span class="hint">You can still save it.</span> <button type="button" class="link" @click="${resetColours}">Reset to Lock-In colours</button>
  </div>`;
}

function resetColours() {
  for (const [k] of COLOURS) {
    draft[k] = DEFAULT_INPUTS[k];
    draft.coloursDefault[k] = true;
  }
  draft.bgColour = null;
}

/**
 * @param {"background" | "text" | "accent" | "accent2"} k
 * @param {string} label
 */
function colourInput(k, label) {
  return html`<label class="swatch">
    <input type="color" value="${() => draft[k]}" @input="${(/** @type {Event} */ e) => { draft[k] = /** @type {HTMLInputElement} */ (e.target).value.toLowerCase(); draft.coloursDefault[k] = false; }}">
    <span>${label}<br><span class="hex">${() => draft[k]}</span></span>
  </label>`;
}

const displayFonts = [...BUNDLED_FONT_INFO.map((f) => ({ id: f.id, label: f.look, cls: "font-" + f.look.toLowerCase() })), { id: "upload", label: "Upload", cls: "" }];

function brandingTab() {
  return html`
  <div class="split">
    <form class="form" @submit="${(/** @type {Event} */ e) => { e.preventDefault(); saveTheme(); }}">
      <div class="field">
        <label for="venue-name">Venue name</label>
        <input id="venue-name" class="input" maxlength="60" spellcheck="true" autocomplete="off" value="${() => draft.name}" @input="${(/** @type {Event} */ e) => { draft.name = /** @type {HTMLInputElement} */ (e.target).value; }}">
        <p class="hint">Shown on the display and phones, and in lines like "Thanks for playing at ${() => draft.name.trim() || "your pub"}".</p>
      </div>

      <div class="field">
        <span class="l">Logo</span>
        <div class="logo-box">
          <div class="logo-thumb" style="${() => "background:" + draft.background}"><img src="${logoSrc}" alt="${() => (draft.logo ? "Your logo" : "The Lock-In padlock")}"></div>
          <div class="row">
            <label class="btn ghost small file-btn">${() => (ui.uploading === "logo" ? "Uploading…" : "Upload PNG, SVG or JPEG")}
              <input type="file" accept="image/png,image/svg+xml,image/jpeg" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "logo"); if (f) draft.logo = f; }}">
            </label>
            ${() => (draft.logo ? html`<button type="button" class="btn ghost small" @click="${() => { draft.logo = null; }}">Use the Lock-In padlock</button>` : "")}
          </div>
        </div>
        <p class="hint">A light logo on a transparent background works best. Up to 2 MB.</p>
      </div>

      <div class="field">
        <span class="l">Colours</span>
        <div class="swatches">${COLOURS.map(([k, label]) => colourInput(k, label))}</div>
      </div>

      <div class="field">
        <span class="l">Display background</span>
        <div class="seg" role="group" aria-label="Display background">
          <button type="button" aria-pressed="${() => String(draft.bgMode === "colour")}" @click="${() => { draft.bgMode = "colour"; }}">Colour</button>
          <button type="button" aria-pressed="${() => String(draft.bgMode === "picture")}" @click="${() => { draft.bgMode = "picture"; }}">Picture</button>
        </div>
        ${() => draft.bgMode === "colour"
          ? html`<div class="row" style="margin-top:8px"><label class="swatch">
              <input type="color" value="${() => draft.bgColour || draft.background}" @input="${(/** @type {Event} */ e) => { draft.bgColour = /** @type {HTMLInputElement} */ (e.target).value.toLowerCase(); }}">
              <span>${() => (draft.bgColour ? "Own colour" : "Same as the background")}</span></label>
              ${() => (draft.bgColour ? html`<button type="button" class="link" @click="${() => { draft.bgColour = null; }}">Use the background colour</button>` : "")}</div>`
          : html`<div><div class="row" style="margin-top:8px">
              <label class="btn ghost small file-btn">${() => (ui.uploading === "displayBackground" ? "Uploading…" : draft.bgImage ? "Change picture" : "Upload JPEG, PNG or WebP")}
                <input type="file" accept="image/jpeg,image/png,image/webp" @change="${async (/** @type {Event} */ e) => { const f = await upload(e, "displayBackground"); if (f) draft.bgImage = f; }}">
              </label></div>
              <p class="hint">Busy photos make questions harder to read. Pick something calm. Up to 5 MB.</p></div>`}
      </div>

      <div class="field">
        <span class="l">Headline font</span>
        <div class="seg" role="group" aria-label="Headline font">${displayFonts.map((f) => html`
          <button type="button" class="${f.cls}" aria-pressed="${() => String(draft.displayFont === f.id)}" @click="${() => { draft.displayFont = f.id; }}">${f.label}</button>`)}
        </div>
        ${() => (draft.displayFont === "upload" ? fontUpload("display") : "")}
        <p class="hint">Used for big titles and the host's lines, never for questions or team names.</p>
      </div>

      <div class="field">
        <span class="l">Body font</span>
        <div class="seg" role="group" aria-label="Body font">
          <button type="button" class="font-plain" aria-pressed="${() => String(draft.bodyFont !== "upload")}" @click="${() => { draft.bodyFont = "atkinson-hyperlegible"; }}">Plain (recommended)</button>
          <button type="button" aria-pressed="${() => String(draft.bodyFont === "upload")}" @click="${() => { draft.bodyFont = "upload"; }}">Upload</button>
        </div>
        ${() => (draft.bodyFont === "upload" ? html`<div>${fontUpload("body")}<p class="hint" style="color:var(--color-warning)">Questions and team names must be easy to read from across the room. A plain font works best.</p></div>` : "")}
      </div>

      ${warnings()}
      ${message()}

      <div class="actions">
        <button type="submit" class="btn primary" disabled="${() => ui.saving || !themeDirty() || (draft.displayFont === "upload" && !draft.displayFontFile) || (draft.bodyFont === "upload" && !draft.bodyFontFile)}">${() => (ui.saving ? "Saving…" : "Save")}</button>
        <button type="button" class="btn ghost" disabled="${() => !themeDirty()}" @click="${() => { draftFromTheme(JSON.parse(page.savedTheme)); ui.message = null; }}">Cancel</button>
        <span class="status">${() => (themeDirty() ? "Not saved yet" : "")}</span>
      </div>
    </form>

    <div class="preview-col">
      <h2>Preview</h2>
      <div class="preview-wrap">${previewDisplay()}${previewPhone()}</div>
    </div>
  </div>`;
}

/** @param {"display" | "body"} role */
function fontUpload(role) {
  const file = () => (role === "display" ? draft.displayFontFile : draft.bodyFontFile);
  return html`<div class="row" style="margin-top:8px">
    <label class="btn ghost small file-btn">${() => (ui.uploading === "font" ? "Uploading…" : file() ? "Change font file" : "Upload WOFF2, WOFF or TTF")}
      <input type="file" accept=".woff2,.woff,.ttf,font/woff2,font/woff,font/ttf" @change="${async (/** @type {Event} */ e) => {
        const f = await upload(e, "font");
        if (!f) return;
        if (role === "display") draft.displayFontFile = f; else draft.bodyFontFile = f;
      }}">
    </label>
    <span class="hint">${() => (file() ? "Font uploaded." : "Up to 2 MB.")}</span>
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

// Keep the uploaded-font @font-face rules in step with the draft.
watch(() => { syncPreviewFonts(); });

load();
