// @ts-check
// Derived brand tokens and readability checks (docs/design/branding.md).
//
// One implementation for both sides: the server imports this file for
// /theme.css and /api/theme/preview.css, and the branding page imports it for
// the live preview and the warnings, so they always agree. It is a plain-JS
// copy of Design's reference, docs/design/tools/derive.ts;
// tests/branding/derive.test.ts checks that the two give the same results.

/** @typedef {[number, number, number]} Rgb */
/**
 * @typedef {object} BrandInputs
 * @property {string} background  #rrggbb
 * @property {string} text
 * @property {string} accent
 * @property {string} accent2
 * @property {string | null} [displayBackgroundColour]
 * @property {string | null} [displayBackgroundImage]  a URL, or null for none
 */
/** @typedef {"ok" | "warn" | "poor"} Level */
/** @typedef {{ pair: string, ratio: number, level: Level, message: string }} ContrastCheck */

/** @type {BrandInputs} */
export const DEFAULT_INPUTS = {
  background: "#17191b",
  text: "#edeae2",
  accent: "#ff7a5c",
  accent2: "#3cc6b8",
};

/** @param {string} hex @returns {Rgb} */
export function parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error("Not a #rrggbb colour: " + hex);
  const n = parseInt(/** @type {string} */ (m[1]), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {Rgb} rgb */
export function toHex(rgb) {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/** Mix in sRGB, like color-mix(in srgb, a, b w). w = share of b, 0..1. @param {string} a @param {string} b @param {number} w */
export function mix(a, b, w) {
  const x = parseHex(a), y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * w, x[1] + (y[1] - x[1]) * w, x[2] + (y[2] - x[2]) * w]);
}

/** @param {number} c */
function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** @param {string} hex */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio, 1..21. @param {string} a @param {string} b */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Every --brand-* colour token (without the leading --) for the inputs.
 * @param {BrandInputs} inp
 * @returns {Record<string, string>}
 */
export function deriveBrandTokens(inp) {
  const bg = inp.background.toLowerCase();
  const text = inp.text.toLowerCase();
  const accent = inp.accent.toLowerCase();
  const accent2 = inp.accent2.toLowerCase();

  const surface = mix(bg, text, 0.03); // D1
  const surface2 = mix(bg, text, 0.08); // D2
  const line = mix(bg, text, 0.16); // D3

  // D4: muted text starts at 68% text and moves toward text until it reaches
  // 4.5:1 on surface-2 (or becomes the text colour).
  let w = 0.32;
  let muted = mix(text, bg, w);
  while (contrast(muted, surface2) < 4.5 && w > 0) {
    w = Math.max(0, w - 0.04);
    muted = mix(text, bg, w);
  }

  // D5: text on a filled accent is bg or text, whichever contrasts more.
  /** @param {string} fill */
  const on = (fill) => (contrast(bg, fill) >= contrast(text, fill) ? bg : text);

  // D7: scrim only when an image is set.
  const [r, g, b] = parseHex(bg);
  const scrim = inp.displayBackgroundImage ? "rgba(" + r + ", " + g + ", " + b + ", 0.78)" : "rgba(0, 0, 0, 0)";

  return {
    "brand-bg": bg,
    "brand-text": text,
    "brand-accent": accent,
    "brand-accent-2": accent2,
    "brand-surface": surface,
    "brand-surface-2": surface2,
    "brand-line": line,
    "brand-text-muted": muted,
    "brand-on-accent": on(accent),
    "brand-on-accent-2": on(accent2),
    "brand-accent-soft": mix(bg, accent, 0.18), // D6
    "brand-accent-2-soft": mix(bg, accent2, 0.18), // D6
    "brand-display-bg": (inp.displayBackgroundColour || bg).toLowerCase(),
    "brand-display-bg-image": inp.displayBackgroundImage ? 'url("' + inp.displayBackgroundImage + '")' : "none",
    "brand-display-scrim": scrim,
  };
}

/**
 * The readability checks the branding screen runs (H-16: warn, never block).
 * Thresholds: branding.md, "Readability warnings".
 * @param {BrandInputs} inp
 * @returns {ContrastCheck[]}
 */
export function checkReadability(inp) {
  const tokens = deriveBrandTokens(inp);
  /** @param {string} k */
  const t = (k) => tokens[k] || "";
  /** @type {[string, string, string, number, number, string][]} */
  const rows = [
    ["Text on background", t("brand-text"), t("brand-bg"), 7, 4.5, "Text may be hard to read from the back of the room."],
    ["Text on panels", t("brand-text"), t("brand-surface-2"), 7, 4.5, "Text on panels may be hard to read from the back of the room."],
    ["Main colour on background", t("brand-accent"), t("brand-bg"), 3, 2, "The main colour may not stand out from the background."],
    ["Second colour on background", t("brand-accent-2"), t("brand-bg"), 3, 2, "The second colour may not stand out from the background."],
    ["Button text on main colour", t("brand-on-accent"), t("brand-accent"), 4.5, 3, "Button labels may be hard to read on the main colour."],
    ["Labels on second colour", t("brand-on-accent-2"), t("brand-accent-2"), 4.5, 3, "Labels may be hard to read on the second colour."],
  ];
  /** @type {ContrastCheck[]} */
  const checks = rows.map(([pair, fg, bgc, ok, poor, message]) => {
    const ratio = Math.round(contrast(fg, bgc) * 100) / 100;
    /** @type {Level} */
    const level = ratio >= ok ? "ok" : ratio >= poor ? "warn" : "poor";
    return { pair, ratio, level, message };
  });
  const bgL = luminance(t("brand-bg"));
  checks.push({
    pair: "Background brightness",
    ratio: Math.round(bgL * 1000) / 1000,
    level: bgL <= 0.05 ? "ok" : bgL <= 0.2 ? "warn" : "poor",
    message: "A light background glares in a dim pub and makes phones hard to use. Dark backgrounds work best.",
  });
  return checks;
}

// ---------------------------------------------------------------------------
// Theme file to inputs, and fonts (shared by /theme.css and the preview)
// ---------------------------------------------------------------------------

/** URL a theme asset ("assets/<file>") is served from (TECH-SPEC 9.1). @param {string} asset */
export function assetUrl(asset) {
  return "/theme/" + asset;
}

/**
 * The derive inputs for a theme file: its colours, with Lock-In's defaults
 * where a colour is null.
 * @param {import('../../../src/shared/formats').ThemeFile} theme
 * @returns {BrandInputs}
 */
export function inputsFromTheme(theme) {
  const c = theme.colours;
  const bg = theme.displayBackground;
  return {
    background: c.background || DEFAULT_INPUTS.background,
    text: c.text || DEFAULT_INPUTS.text,
    accent: c.accent || DEFAULT_INPUTS.accent,
    accent2: c.accent2 || DEFAULT_INPUTS.accent2,
    displayBackgroundColour: bg && "colour" in bg ? bg.colour : null,
    displayBackgroundImage: bg && "image" in bg ? assetUrl(bg.image) : null,
  };
}

/**
 * Bundled fonts (docs/design/branding.md, "Fonts"): id, family name, the look
 * shown on the branding screen, and the files served from /static/fonts/.
 * @type {{ id: string, family: string, look: string, files: { weight: number, url: string }[] }[]}
 */
export const BUNDLED_FONT_INFO = [
  { id: "caveat-brush", family: "Caveat Brush", look: "Chalk", files: [{ weight: 400, url: "/static/fonts/caveat-brush-400.woff2" }] },
  { id: "alfa-slab-one", family: "Alfa Slab One", look: "Sign", files: [{ weight: 400, url: "/static/fonts/alfa-slab-one-400.woff2" }] },
  { id: "bebas-neue", family: "Bebas Neue", look: "Neon", files: [{ weight: 400, url: "/static/fonts/bebas-neue-400.woff2" }] },
  {
    id: "atkinson-hyperlegible", family: "Atkinson Hyperlegible", look: "Plain",
    files: [{ weight: 400, url: "/static/fonts/atkinson-hyperlegible-400.woff2" }, { weight: 700, url: "/static/fonts/atkinson-hyperlegible-700.woff2" }],
  },
];

/** The fallbacks after the chosen family, as in assets/tokens.css. */
export const DISPLAY_FALLBACK = '"Atkinson Hyperlegible", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const BODY_FALLBACK = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';
