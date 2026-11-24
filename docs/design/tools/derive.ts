/**
 * Reference implementation of the derived brand tokens (docs/design/branding.md,
 * "Derived tokens"). The server's /theme.css and the branding screen's live
 * preview must produce the same values. Pure functions, no dependencies.
 */

export type Rgb = [number, number, number];

export interface BrandInputs {
  background: string; // #rrggbb
  text: string;
  accent: string;
  accent2: string;
  displayBackgroundColour?: string | null;
  displayBackgroundImage?: string | null; // a URL, or null for none
}

export const DEFAULT_INPUTS: BrandInputs = {
  background: "#17191b",
  text: "#edeae2",
  accent: "#ff7a5c",
  accent2: "#3cc6b8",
};

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/** Mix in sRGB, like color-mix(in srgb, a, b w). w = share of b, 0..1. */
export function mix(a: string, b: string, w: number): string {
  const x = parseHex(a), y = parseHex(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * w) as Rgb);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Returns every --brand-* token (without the leading --) for the inputs. */
export function deriveBrandTokens(inp: BrandInputs): Record<string, string> {
  const bg = inp.background.toLowerCase();
  const text = inp.text.toLowerCase();
  const accent = inp.accent.toLowerCase();
  const accent2 = inp.accent2.toLowerCase();

  const surface = mix(bg, text, 0.03); // D1
  const surface2 = mix(bg, text, 0.08); // D2
  const line = mix(bg, text, 0.16); // D3

  // D4: muted text starts at 68% text, and moves toward text until it
  // reaches 4.5:1 on surface-2 (or becomes the text colour).
  let w = 0.32;
  let muted = mix(text, bg, w);
  while (contrast(muted, surface2) < 4.5 && w > 0) {
    w = Math.max(0, w - 0.04);
    muted = mix(text, bg, w);
  }

  // D5: text on a filled accent is bg or text, whichever contrasts more.
  const on = (fill: string) => (contrast(bg, fill) >= contrast(text, fill) ? bg : text);

  // D7: scrim only when an image is set.
  const [r, g, b] = parseHex(bg);
  const scrim = inp.displayBackgroundImage ? `rgba(${r}, ${g}, ${b}, 0.78)` : "rgba(0, 0, 0, 0)";

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
    "brand-display-bg": (inp.displayBackgroundColour ?? bg).toLowerCase(),
    "brand-display-bg-image": inp.displayBackgroundImage ? `url("${inp.displayBackgroundImage}")` : "none",
    "brand-display-scrim": scrim,
  };
}

export type Level = "ok" | "warn" | "poor";

export interface ContrastCheck {
  pair: string;
  ratio: number;
  level: Level;
  message: string;
}

/**
 * The readability checks the branding screen runs (H-16: warn, never block).
 * Thresholds: branding.md, "Readability warnings".
 */
export function checkReadability(inp: BrandInputs): ContrastCheck[] {
  const t = deriveBrandTokens(inp);
  const rows: [string, string, string, number, number, string][] = [
    // pair label, fg, bg, ok at, poor below, message
    ["Text on background", t["brand-text"], t["brand-bg"], 7, 4.5, "Text may be hard to read from the back of the room."],
    ["Text on panels", t["brand-text"], t["brand-surface-2"], 7, 4.5, "Text on panels may be hard to read from the back of the room."],
    ["Main colour on background", t["brand-accent"], t["brand-bg"], 3, 2, "The main colour may not stand out from the background."],
    ["Second colour on background", t["brand-accent-2"], t["brand-bg"], 3, 2, "The second colour may not stand out from the background."],
    ["Button text on main colour", t["brand-on-accent"], t["brand-accent"], 4.5, 3, "Button labels may be hard to read on the main colour."],
    ["Labels on second colour", t["brand-on-accent-2"], t["brand-accent-2"], 4.5, 3, "Labels may be hard to read on the second colour."],
  ];
  const checks = rows.map(([pair, fg, bgc, ok, poor, message]) => {
    const ratio = Math.round(contrast(fg, bgc) * 100) / 100;
    const level: Level = ratio >= ok ? "ok" : ratio >= poor ? "warn" : "poor";
    return { pair, ratio, level, message };
  });
  // Phones and display are dark by default (brief); a light background is allowed
  // but warned, because a bright display glares in a dim pub.
  const bgL = luminance(t["brand-bg"]);
  checks.push({
    pair: "Background brightness",
    ratio: Math.round(bgL * 1000) / 1000,
    level: bgL <= 0.05 ? "ok" : bgL <= 0.2 ? "warn" : "poor",
    message: "A light background glares in a dim pub and makes phones hard to use. Dark backgrounds work best.",
  });
  return checks;
}
