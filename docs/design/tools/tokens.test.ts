// Checks the design tokens and display wireframe CSS against the rules in docs/design.
// Run: bun test docs/design
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { contrast, deriveBrandTokens, checkReadability, DEFAULT_INPUTS } from "./derive.ts";

const dir = join(import.meta.dir, "..");
const tokensCss = readFileSync(join(dir, "tokens.css"), "utf8");
const displayCss = readFileSync(join(dir, "wireframes", "display.css"), "utf8");

function rootVars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
const vars = rootVars(tokensCss);
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("tokens.css", () => {
  test("derived brand tokens match derive.ts for the default inputs", () => {
    const derived = deriveBrandTokens(DEFAULT_INPUTS);
    for (const [k, v] of Object.entries(derived)) expect(`${k}: ${vars[k]}`).toBe(`${k}: ${v}`);
  });

  test("every --brand-* token is tagged @brand or @derived", () => {
    const tagged = [...tokensCss.matchAll(/--(brand-[a-z0-9-]+)\s*:[^;]+;\s*\/\*\s*@(brand|derived)/g)].map((m) => m[1]);
    const all = Object.keys(vars).filter((k) => k.startsWith("brand-"));
    expect(tagged.sort()).toEqual(all.sort());
  });

  test("has --team-1 to --team-8, each readable on the default background and under team-on text", () => {
    for (let i = 1; i <= 8; i++) {
      const c = vars[`team-${i}`];
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(c, vars["brand-bg"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, vars["team-on"])).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("default theme passes every readability check", () => {
    for (const c of checkReadability(DEFAULT_INPUTS)) expect(`${c.pair}: ${c.level}`).toBe(`${c.pair}: ok`);
  });

  test("uses nothing outside the display baseline (resolved values only)", () => {
    expect(stripComments(tokensCss)).not.toMatch(/color-mix\(|clamp\(|\bmin\(|\bmax\(|oklch\(|lab\(/i);
  });
});

describe("readability warnings", () => {
  test("a light, low-contrast theme is warned, never blocked", () => {
    const checks = checkReadability({ background: "#f4efe4", text: "#5c5c5c", accent: "#ffd54f", accent2: "#9ad0c2" });
    const bad = checks.filter((c) => c.level !== "ok").map((c) => c.pair);
    expect(bad).toContain("Background brightness");
    expect(bad).toContain("Main colour on background");
  });

  test("muted text is raised to 4.5:1 on panels even with a dull text colour", () => {
    const t = deriveBrandTokens({ background: "#202020", text: "#9a9a9a", accent: "#ff7a5c", accent2: "#3cc6b8" });
    // Either it reaches 4.5:1, or it has become the text colour itself (nothing better exists).
    const ok = contrast(t["brand-text-muted"], t["brand-surface-2"]) >= 4.5 || t["brand-text-muted"] === t["brand-text"];
    expect(ok).toBe(true);
  });

  test("text on an accent fill picks the better of background and text", () => {
    const t = deriveBrandTokens({ background: "#101010", text: "#ffffff", accent: "#1d4ed8", accent2: "#facc15" });
    expect(t["brand-on-accent"]).toBe("#ffffff");
    expect(t["brand-on-accent-2"]).toBe("#101010");
  });
});

describe("Display CSS baseline (Chromium 56 / Safari 11)", () => {
  const css = stripComments(displayCss);
  const banned: [string, RegExp][] = [
    ["grid", /display\s*:\s*(inline-)?grid|grid-template|grid-area|place-items/i],
    ["flex gap", /(^|[;{\s])(row-|column-)?gap\s*:/i],
    ["clamp/min/max", /clamp\(|\bmin\(|\bmax\(/i],
    ["aspect-ratio", /aspect-ratio/i],
    [":is/:where", /:is\(|:where\(/i],
    ["backdrop-filter", /backdrop-filter/i],
    ["conic-gradient", /conic-gradient/i],
    ["color-mix", /color-mix\(/i],
    ["inset shorthand", /(^|[;{\s])inset\s*:/i],
  ];
  for (const [name, re] of banned) test(`no ${name}`, () => expect(css).not.toMatch(re));

  test("every display font size uses a --display-text-* token or em", () => {
    const sizes = [...css.matchAll(/font-size\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const s of sizes) expect(s).toMatch(/^var\(--display-text-[a-z]+\)$|^[0-9.]+em$/);
  });
});

describe("sample venue themes", () => {
  test("each sample theme only sets known tokens", () => {
    const themeDir = join(dir, "wireframes", "themes");
    for (const f of readdirSync(themeDir)) {
      const v = rootVars(readFileSync(join(themeDir, f), "utf8"));
      const unknown = Object.keys(v).filter((k) => !k.startsWith("wf-") && !(k in vars));
      expect(`${f}: ${unknown.join(", ")}`).toBe(`${f}: `);
    }
  });
});
