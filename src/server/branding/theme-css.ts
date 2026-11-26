// Writes the venue theme as CSS (TECH-SPEC 5.3, docs/DESIGN-SYSTEM.md "Venue branding"):
// the venue tokens (--venue, --venue-tint, --on-venue, the TV background) that override
// assets/tokens.css. Used by GET /theme.css (on :root) and by GET /api/theme/preview.css
// (scoped to the branding page's preview). Fonts are fixed in Last Call, so no @font-face.

import type { ThemeFile } from "../../shared/formats.ts";
import { deriveBrandTokens, inputsFromTheme } from "./derive.ts";

export interface ThemeCssOptions {
  /** Selector the properties are declared on. Default ":root". */
  selector?: string;
  /** Written in the header comment. */
  version?: string;
}

const VENUE_ROLES: [string, string][] = [
  ["color-action", "venue"], ["color-on-action", "on-venue"], ["color-action-tint", "venue-tint"],
  ["color-selected", "venue"], ["color-correct", "venue"], ["color-countdown", "venue"],
];

/** The CSS for a theme. Every value in it comes from a validated ThemeFile, so nothing user-typed reaches the CSS unchecked. */
export function themeCss(theme: ThemeFile, opts: ThemeCssOptions = {}): string {
  const selector = opts.selector ?? ":root";
  const tokens = deriveBrandTokens(inputsFromTheme(theme));
  const lines = Object.entries(tokens).map(([k, v]) => `  --${k}: ${v};`);
  // The roles that point at the venue are re-declared too, so a scoped preview (whose
  // :root still holds the live theme) resolves them against its own venue colour.
  for (const [role, token] of VENUE_ROLES) lines.push(`  --${role}: var(--${token});`);
  const header = `/* Lock-In venue theme${opts.version ? `, version ${opts.version}` : ""}. Generated from theme/theme.json: edit it on the host console's Branding page. */`;
  return `${header}\n${selector} {\n${lines.join("\n")}\n}\n`;
}
