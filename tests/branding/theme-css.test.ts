// GET /theme.css content (TECH-SPEC 5.3, docs/design/branding.md).
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
  test("the default theme gives exactly the --brand-* values in docs/design/tokens.css", () => {
    const tokens = vars(readFileSync(join(ROOT, "docs/design/tokens.css"), "utf8"));
    const css = vars(themeCss(defaultTheme()));
    const brandKeys = Object.keys(tokens).filter((k) => k.startsWith("brand-"));
    expect(Object.keys(css).sort()).toEqual(brandKeys.sort());
    for (const k of brandKeys) expect(`${k}: ${css[k]}`).toBe(`${k}: ${tokens[k]}`);
  });

  for (const sample of ["brass-and-oak", "neon-taproom", "too-light"]) {
    test(`derived colours for the sample theme "${sample}" match Design's generated theme`, () => {
      const expected = vars(readFileSync(join(ROOT, `docs/design/wireframes/themes/${sample}.css`), "utf8"));
      const css = vars(themeCss(theme({
        colours: { background: expected["brand-bg"]!, text: expected["brand-text"]!, accent: expected["brand-accent"]!, accent2: expected["brand-accent-2"]! },
      })));
      for (const [k, v] of Object.entries(expected)) {
        if (k.startsWith("brand-") && k !== "brand-font-display") expect(`${k}: ${css[k]}`).toBe(`${k}: ${v}`);
      }
    });
  }

  test("a sample theme's derived colours, spelled out (brass and oak)", () => {
    const css = vars(themeCss(theme({ colours: { background: "#1c140f", text: "#f3e6cc", accent: "#d9a441", accent2: "#8cc2a8" } })));
    expect(css["brand-surface"]).toBe("#221a15");
    expect(css["brand-surface-2"]).toBe("#2d251e");
    expect(css["brand-line"]).toBe("#3e362d");
    expect(css["brand-text-muted"]).toBe("#aea390");
    expect(css["brand-on-accent"]).toBe("#1c140f");
    expect(css["brand-accent-soft"]).toBe("#3e2e18");
    expect(css["brand-accent-2-soft"]).toBe("#30332b");
  });

  test("a missing colour falls back to Lock-In's default", () => {
    const css = vars(themeCss(theme({ colours: { background: "#0e0b1a", text: null, accent: null, accent2: null } })));
    expect(css["brand-bg"]).toBe("#0e0b1a");
    expect(css["brand-text"]).toBe("#edeae2");
    expect(css["brand-accent"]).toBe("#ff7a5c");
  });

  test("display background: a colour, or a picture under the D7 scrim", () => {
    const colour = vars(themeCss(theme({ displayBackground: { colour: "#223344" } })));
    expect(colour["brand-display-bg"]).toBe("#223344");
    expect(colour["brand-display-bg-image"]).toBe("none");
    expect(colour["brand-display-scrim"]).toBe("rgba(0, 0, 0, 0)");
    const pic = vars(themeCss(theme({ displayBackground: { image: "assets/background-0123456789.jpg" } })));
    expect(pic["brand-display-bg"]).toBe("#17191b");
    expect(pic["brand-display-bg-image"]).toBe('url("/theme/assets/background-0123456789.jpg")');
    expect(pic["brand-display-scrim"]).toBe("rgba(23, 25, 27, 0.78)");
  });

  test("default fonts: @font-face for Caveat Brush and both Atkinson weights, served from /static/fonts", () => {
    const css = themeCss(defaultTheme());
    expect(css).toContain('@font-face { font-family: "Caveat Brush"; font-weight: 400; src: url("/static/fonts/caveat-brush-400.woff2") format("woff2");');
    expect(css).toContain('src: url("/static/fonts/atkinson-hyperlegible-400.woff2")');
    expect(css).toContain('src: url("/static/fonts/atkinson-hyperlegible-700.woff2")');
  });

  test("a bundled display font is named first, with the tokens.css fallbacks", () => {
    const css = themeCss(theme({ fonts: { display: { bundled: "bebas-neue" }, body: null } }));
    expect(vars(css)["brand-font-display"]).toBe('"Bebas Neue", "Atkinson Hyperlegible", "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
    expect(css).toContain('src: url("/static/fonts/bebas-neue-400.woff2")');
    expect(css).not.toContain("Caveat Brush");
  });

  test("uploaded fonts get their own family and @font-face with the right format", () => {
    const css = themeCss(theme({ fonts: { display: { file: "assets/font-aaaaaaaaaa.ttf" }, body: { file: "assets/font-bbbbbbbbbb.woff" } } }));
    expect(css).toContain('@font-face { font-family: "Lock-In Venue Display"; src: url("/theme/assets/font-aaaaaaaaaa.ttf") format("truetype");');
    expect(css).toContain('@font-face { font-family: "Lock-In Venue Body"; src: url("/theme/assets/font-bbbbbbbbbb.woff") format("woff");');
    expect(vars(css)["brand-font-body"]).toBe('"Lock-In Venue Body", "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
  });

  test("the preview variant is scoped and uses its own family names", () => {
    const css = themeCss(theme({ fonts: { display: { file: "assets/font-aaaaaaaaaa.woff2" }, body: null } }), { selector: ".lockin-preview", familyPrefix: "Lock-In Preview" });
    expect(css).toContain(".lockin-preview {");
    expect(css).not.toContain(":root");
    expect(css).toContain('"Lock-In Preview Display"');
  });

  test("uses nothing the display baseline lacks (no color-mix, oklch)", () => {
    const css = themeCss(theme({ colours: { background: "#0e0b1a", text: "#f2f0ff", accent: "#ff3ea5", accent2: "#2ef2e2" }, displayBackground: { image: "assets/background-0123456789.png" } }));
    expect(css).not.toMatch(/color-mix|oklch|lab\(/);
  });
});
