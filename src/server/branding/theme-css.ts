// Writes the venue theme as CSS (TECH-SPEC 5.3, docs/design/branding.md):
// the resolved --brand-* custom properties and the @font-face rules for the
// chosen fonts. Used by GET /theme.css (on :root) and by
// GET /api/theme/preview.css (scoped to the branding page's preview).

import type { FontRef, ThemeFile } from "../../shared/formats.ts";
import {
  BODY_FALLBACK, BUNDLED_FONT_INFO, DISPLAY_FALLBACK, assetUrl, deriveBrandTokens, inputsFromTheme,
} from "../../../public/host/brand/derive.js";

export const DEFAULT_DISPLAY_FONT = "caveat-brush";
export const DEFAULT_BODY_FONT = "atkinson-hyperlegible";

export interface ThemeCssOptions {
  /** Selector the properties are declared on. Default ":root". */
  selector?: string;
  /** Family-name prefix for uploaded fonts, so the preview's fonts never replace the live theme's. */
  familyPrefix?: string;
  /** Written in the header comment. */
  version?: string;
}

const FORMATS: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype" };

function quote(family: string): string {
  return `"${family.replace(/["\\]/g, "")}"`;
}

/** The CSS for a theme. Every value in it comes from a validated ThemeFile, so nothing user-typed reaches the CSS unchecked. */
export function themeCss(theme: ThemeFile, opts: ThemeCssOptions = {}): string {
  const selector = opts.selector ?? ":root";
  const prefix = opts.familyPrefix ?? "Lock-In Venue";
  const faces: string[] = [];
  const bundledDone = new Set<string>();

  const fontFamily = (ref: FontRef | null, role: "display" | "body"): string => {
    const r: FontRef = ref ?? { bundled: role === "display" ? DEFAULT_DISPLAY_FONT : DEFAULT_BODY_FONT };
    if ("file" in r) {
      const family = `${prefix} ${role === "display" ? "Display" : "Body"}`;
      const ext = r.file.toLowerCase().split(".").pop() ?? "";
      faces.push(`@font-face { font-family: ${quote(family)}; src: url("${assetUrl(r.file)}") format("${FORMATS[ext] ?? "woff2"}"); font-display: swap; }`);
      return family;
    }
    const info = BUNDLED_FONT_INFO.find((f) => f.id === r.bundled) ?? BUNDLED_FONT_INFO.find((f) => f.id === DEFAULT_BODY_FONT)!;
    if (!bundledDone.has(info.id)) {
      bundledDone.add(info.id);
      for (const f of info.files) {
        faces.push(`@font-face { font-family: ${quote(info.family)}; font-weight: ${f.weight}; src: url("${f.url}") format("woff2"); font-display: swap; }`);
      }
    }
    return info.family;
  };

  const display = fontFamily(theme.fonts.display, "display");
  const body = fontFamily(theme.fonts.body, "body");
  const displayStack = display === "Atkinson Hyperlegible" ? `${quote(display)}, ${BODY_FALLBACK}` : `${quote(display)}, ${DISPLAY_FALLBACK}`;

  const tokens = deriveBrandTokens(inputsFromTheme(theme));
  const lines = Object.entries(tokens).map(([k, v]) => `  --${k}: ${v};`);
  lines.push(`  --brand-font-display: ${displayStack};`);
  lines.push(`  --brand-font-body: ${quote(body)}, ${BODY_FALLBACK};`);

  const header = `/* Lock-In venue theme${opts.version ? `, version ${opts.version}` : ""}. Generated from theme/theme.json: edit it on the host console's Branding page. */`;
  return `${header}\n${faces.join("\n")}${faces.length ? "\n" : ""}${selector} {\n${lines.join("\n")}\n}\n`;
}
