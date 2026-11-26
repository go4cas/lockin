// GET /theme.css content (TECH-SPEC 5.3, docs/DESIGN-SYSTEM.md "Venue branding").
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultTheme, type ThemeFile } from "../../src/shared/formats.ts";
import { themeCss } from "../../src/server/branding/theme-css.ts";

const ROOT = join(import.meta.dir, "../..");

/** The custom properties declared in a CSS text, comments removed. */
function vars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]!] = m[2]!.trim();
  return out;
}

function theme(patch: Partial<ThemeFile>): ThemeFile {
  return { ...defaultTheme(), ...patch };
}

describe("themeCss", () => {
  test("the default theme gives exactly the venue values in assets/tokens.css", () => {
    const tokens = vars(readFileSync(join(ROOT, "assets/tokens.css"), "utf8"));
    const css = vars(themeCss(defaultTheme()));
    for (const k of ["venue", "venue-tint", "on-venue", "display-bg-image", "display-scrim"]) {
      expect(`${k}: ${css[k]}`).toBe(`${k}: ${tokens[k]}`);
    }
  });

  test("the venue roles point at the venue tokens, so a scoped preview resolves its own colour", () => {
    const css = vars(themeCss(defaultTheme()));
    expect(css["color-action"]).toBe("var(--venue)");
    expect(css["color-on-action"]).toBe("var(--on-venue)");
    expect(css["color-countdown"]).toBe("var(--venue)");
  });

  test("a main colour sets --venue, its tint and the label colour", () => {
    const css = vars(themeCss(theme({ colours: { accent: "#d9a441" } })));
    expect(css["venue"]).toBe("#d9a441");
    expect(css["on-venue"]).toBe("#0b0b0c");
    expect(css["venue-tint"]).toMatch(/^#[0-9a-f]{6}$/);
    const dark = vars(themeCss(theme({ colours: { accent: "#1a237e" } })));
    expect(dark["on-venue"]).toBe("#edede8");
  });

  test("no main colour falls back to Lock-In's Mint", () => {
    expect(vars(themeCss(theme({ colours: { accent: null } })))["venue"]).toBe("#7df0c3");
  });

  test("a TV picture sits under the Ink scrim", () => {
    const plain = vars(themeCss(defaultTheme()));
    expect(plain["display-bg-image"]).toBe("none");
    expect(plain["display-scrim"]).toBe("rgba(11, 11, 12, 0)");
    const pic = vars(themeCss(theme({ displayBackground: { image: "assets/background-0123456789.jpg" } })));
    expect(pic["display-bg-image"]).toBe('url("/theme/assets/background-0123456789.jpg")');
    expect(pic["display-scrim"]).toBe("rgba(11, 11, 12, 0.78)");
  });

  test("fonts are fixed: no @font-face", () => {
    expect(themeCss(defaultTheme())).not.toContain("@font-face");
  });

  test("the preview variant is scoped", () => {
    const css = themeCss(defaultTheme(), { selector: ".lockin-preview" });
    expect(css).toContain(".lockin-preview {");
    expect(css).not.toContain(":root");
  });

  test("uses nothing the display baseline lacks (no color-mix, oklch)", () => {
    const css = themeCss(theme({ colours: { accent: "#ff3ea5" }, displayBackground: { image: "assets/background-0123456789.png" } }));
    expect(css).not.toMatch(/color-mix|oklch|lab\(/);
  });
});
