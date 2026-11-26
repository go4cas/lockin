// Server copy of public/host/brand/derive.js (docs/DESIGN-SYSTEM.md, "Venue branding").
//
// The page's file cannot be imported here: the compiled binary embeds every
// file under public/ as a raw file (B8, scripts/build.ts), and the bundler then
// refuses to also import it as a module. tests/branding/derive.test.ts checks
// that this file and the page's derive.js give the same results.

import type { ThemeFile } from "../../shared/formats.ts";

export interface BrandInputs {
  accent: string;
  displayBackgroundImage?: string | null;
}

export const INK = "#0b0b0c";
export const BONE = "#edede8";
export const DEFAULT_INPUTS: BrandInputs = { accent: "#7df0c3" };

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

export function onVenue(accent: string): string {
  return contrast(INK, accent) >= 4.5 ? INK : BONE;
}

export function deriveBrandTokens(inp: BrandInputs): Record<string, string> {
  const accent = inp.accent.toLowerCase();
  return {
    "venue": accent,
    "venue-tint": mix(INK, accent, 0.16),
    "on-venue": onVenue(accent),
    "display-bg-image": inp.displayBackgroundImage ? `url("${inp.displayBackgroundImage}")` : "none",
    "display-scrim": inp.displayBackgroundImage ? "rgba(11, 11, 12, 0.78)" : "rgba(11, 11, 12, 0)",
  };
}

/** URL a theme asset ("assets/<file>") is served from (TECH-SPEC 9.1). */
export function assetUrl(asset: string): string {
  return "/theme/" + asset;
}

export function inputsFromTheme(theme: ThemeFile): BrandInputs {
  const bg = theme.displayBackground;
  return {
    accent: theme.colours.accent || DEFAULT_INPUTS.accent,
    displayBackgroundImage: bg ? assetUrl(bg.image) : null,
  };
}
