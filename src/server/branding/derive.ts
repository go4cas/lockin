// Server copy of public/host/brand/derive.js (docs/design/branding.md, "Derived tokens").
//
// The page's file cannot be imported here: the compiled binary embeds every
// file under public/ as a raw file (B8, scripts/build.ts), and the bundler then
// refuses to also import it as a module. tests/branding/derive.test.ts checks
// that this file, the page's derive.js and Design's docs/design/tools/derive.ts
// all give the same results, so they cannot drift.

import type { ThemeFile } from "../../shared/formats.ts";

export interface BrandInputs {
  background: string;
  text: string;
  accent: string;
  accent2: string;
  displayBackgroundColour?: string | null;
  displayBackgroundImage?: string | null;
}

export const DEFAULT_INPUTS: BrandInputs = { background: "#17191b", text: "#edeae2", accent: "#ff7a5c", accent2: "#3cc6b8" };

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: Rgb): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

export function mix(a: string, b: string, w: number): string {
  const x = parseHex(a), y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * w, x[1] + (y[1] - x[1]) * w, x[2] + (y[2] - x[2]) * w]);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function deriveBrandTokens(inp: BrandInputs): Record<string, string> {
  const bg = inp.background.toLowerCase();
  const text = inp.text.toLowerCase();
  const accent = inp.accent.toLowerCase();
  const accent2 = inp.accent2.toLowerCase();
  const surface2 = mix(bg, text, 0.08);
  let w = 0.32;
  let muted = mix(text, bg, w);
  while (contrast(muted, surface2) < 4.5 && w > 0) {
    w = Math.max(0, w - 0.04);
    muted = mix(text, bg, w);
  }
  const on = (fill: string) => (contrast(bg, fill) >= contrast(text, fill) ? bg : text);
  const [r, g, b] = parseHex(bg);
  return {
    "brand-bg": bg,
    "brand-text": text,
    "brand-accent": accent,
    "brand-accent-2": accent2,
    "brand-surface": mix(bg, text, 0.03),
    "brand-surface-2": surface2,
    "brand-line": mix(bg, text, 0.16),
    "brand-text-muted": muted,
    "brand-on-accent": on(accent),
    "brand-on-accent-2": on(accent2),
    "brand-accent-soft": mix(bg, accent, 0.18),
    "brand-accent-2-soft": mix(bg, accent2, 0.18),
    "brand-display-bg": (inp.displayBackgroundColour || bg).toLowerCase(),
    "brand-display-bg-image": inp.displayBackgroundImage ? `url("${inp.displayBackgroundImage}")` : "none",
    "brand-display-scrim": inp.displayBackgroundImage ? `rgba(${r}, ${g}, ${b}, 0.78)` : "rgba(0, 0, 0, 0)",
  };
}

/** URL a theme asset ("assets/<file>") is served from (TECH-SPEC 9.1). */
export function assetUrl(asset: string): string {
  return "/theme/" + asset;
}

export function inputsFromTheme(theme: ThemeFile): BrandInputs {
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

export const BUNDLED_FONT_INFO: { id: string; family: string; look: string; files: { weight: number; url: string }[] }[] = [
  { id: "caveat-brush", family: "Caveat Brush", look: "Chalk", files: [{ weight: 400, url: "/static/fonts/caveat-brush-400.woff2" }] },
  { id: "alfa-slab-one", family: "Alfa Slab One", look: "Sign", files: [{ weight: 400, url: "/static/fonts/alfa-slab-one-400.woff2" }] },
  { id: "bebas-neue", family: "Bebas Neue", look: "Neon", files: [{ weight: 400, url: "/static/fonts/bebas-neue-400.woff2" }] },
  {
    id: "atkinson-hyperlegible", family: "Atkinson Hyperlegible", look: "Plain",
    files: [{ weight: 400, url: "/static/fonts/atkinson-hyperlegible-400.woff2" }, { weight: 700, url: "/static/fonts/atkinson-hyperlegible-700.woff2" }],
  },
];

export const DISPLAY_FALLBACK = '"Atkinson Hyperlegible", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const BODY_FALLBACK = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';
