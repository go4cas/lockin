// @ts-check
// Venue colour tokens and readability checks (docs/DESIGN-SYSTEM.md, "Venue branding").
//
// In Last Call a venue sets one colour, the main colour (--venue). Everything else is
// fixed. The branding page imports this file for the live preview and the warnings; the
// server keeps a TypeScript copy (src/server/branding/derive.ts) for /theme.css, and
// tests/branding/derive.test.ts checks that the two give the same results.

/** @typedef {[number, number, number]} Rgb */
/**
 * @typedef {object} BrandInputs
 * @property {string} accent  the main colour, #rrggbb
 * @property {string | null} [displayBackgroundImage]  a URL, or null for plain Ink
 */
/** @typedef {"ok" | "warn"} Level */
/** @typedef {{ pair: string, ratio: number, level: Level, message: string }} ContrastCheck */

export const INK = "#0b0b0c";
export const BONE = "#edede8";

/** @type {BrandInputs} */
export const DEFAULT_INPUTS = { accent: "#7df0c3" };

/** The status colours a venue colour must not be mistaken for (fixed in every venue). */
export const STATUS_COLOURS = [
  { name: "green", hex: "#2fa866" },
  { name: "red", hex: "#e5484d" },
  { name: "amber", hex: "#d99a1e" },
  { name: "blue", hex: "#3a85e0" },
];

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

/** Straight-line distance between two colours in sRGB, 0..441. @param {string} a @param {string} b */
export function distance(a, b) {
  const x = parseHex(a), y = parseHex(b);
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

/** Text on a venue fill: Ink, or Bone if Ink falls under 4.5:1 on it. @param {string} accent */
export function onVenue(accent) {
  return contrast(INK, accent) >= 4.5 ? INK : BONE;
}

/**
 * The venue tokens (without the leading --) that /theme.css writes over assets/tokens.css.
 * @param {BrandInputs} inp
 * @returns {Record<string, string>}
 */
export function deriveBrandTokens(inp) {
  const accent = inp.accent.toLowerCase();
  return {
    "venue": accent,
    "venue-tint": mix(INK, accent, 0.16),
    "on-venue": onVenue(accent),
    "display-bg-image": inp.displayBackgroundImage ? 'url("' + inp.displayBackgroundImage + '")' : "none",
    "display-scrim": inp.displayBackgroundImage ? "rgba(11, 11, 12, 0.78)" : "rgba(11, 11, 12, 0)",
  };
}

/**
 * The checks the branding screen runs on the main colour (warn, never block).
 * @param {BrandInputs} inp
 * @returns {ContrastCheck[]}
 */
export function checkReadability(inp) {
  const accent = inp.accent.toLowerCase();
  const onInk = Math.round(contrast(accent, INK) * 100) / 100;
  const label = Math.round(contrast(onVenue(accent), accent) * 100) / 100;
  const near = STATUS_COLOURS.map((s) => ({ ...s, d: distance(accent, s.hex) })).sort((a, b) => a.d - b.d)[0];
  const nearest = /** @type {{ name: string, hex: string, d: number }} */ (near);
  return [
    {
      pair: "Main colour on the black background", ratio: onInk, level: onInk >= 3 ? "ok" : "warn",
      message: "The main colour may not stand out on the black background.",
    },
    {
      pair: "Button labels on the main colour", ratio: label, level: label >= 4.5 ? "ok" : "warn",
      message: "Button labels may be hard to read on the main colour.",
    },
    {
      pair: "Different from the status colours", ratio: Math.round(nearest.d), level: nearest.d >= 64 ? "ok" : "warn",
      message: "The main colour is close to the " + nearest.name + " Lock-In uses for status, so it could be mistaken for one.",
    },
  ];
}

/** URL a theme asset ("assets/<file>") is served from (TECH-SPEC 9.1). @param {string} asset */
export function assetUrl(asset) {
  return "/theme/" + asset;
}

/**
 * The derive inputs for a theme file, with Lock-In's default where the colour is null.
 * @param {import('../../../src/shared/formats').ThemeFile} theme
 * @returns {BrandInputs}
 */
export function inputsFromTheme(theme) {
  const bg = theme.displayBackground;
  return {
    accent: theme.colours.accent || DEFAULT_INPUTS.accent,
    displayBackgroundImage: bg ? assetUrl(bg.image) : null,
  };
}
