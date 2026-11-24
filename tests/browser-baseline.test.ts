// TECH-SPEC 3.3: public/display/, public/shared/ and public/vendor/ must run on Chromium 86 / Safari 14.
// TECH-SPEC 12.4: no page script parses data as HTML.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanCss, scanHtml, scanHtmlSinks, scanJs, type Finding } from "./helpers/baseline.ts";

const ROOT = join(import.meta.dir, "..");
const SCANNED = ["public/display", "public/shared", "public/vendor"];

function filesIn(folder: string, pattern: string): string[] {
  if (!existsSync(join(ROOT, folder))) return [];   // e.g. public/display/ before B6
  return [...new Bun.Glob(pattern).scanSync({ cwd: join(ROOT, folder), onlyFiles: true })].map((f) => `${folder}/${f}`);
}

function scanFolder(folder: string): { files: string[]; findings: Finding[] } {
  const files = filesIn(folder, "**/*.{js,mjs,css,html}");
  const findings: Finding[] = [];
  for (const file of files) {
    const code = readFileSync(join(ROOT, file), "utf8");
    if (/\.m?js$/.test(file)) findings.push(...scanJs(code, file));
    else if (file.endsWith(".css")) findings.push(...scanCss(code, file));
    else findings.push(...scanHtml(code, file));
  }
  return { files, findings };
}

describe("display browser baseline", () => {
  for (const folder of SCANNED) {
    test(`${folder}/ uses only baseline JS and CSS`, () => {
      const { findings } = scanFolder(folder);
      const report = findings.map((f) => `${f.file}:${f.line} ${f.rule}: ${f.text}`);
      expect(report).toEqual([]);
    });
  }

  test("public/shared/ has files to scan", () => {
    expect(scanFolder("public/shared").files.length).toBeGreaterThan(3);
  });

  test("public/vendor/ has the Arrow files to scan", () => {
    expect(scanFolder("public/vendor").files).toContain("public/vendor/arrow/index.mjs");
  });
});

describe("no HTML sinks in page code (TECH-SPEC 12.4)", () => {
  test("public/ outside public/vendor/ never uses innerHTML, outerHTML, insertAdjacentHTML or document.write", () => {
    const files = filesIn("public", "**/*.{js,mjs,html}").filter((f) => !f.startsWith("public/vendor/"));
    expect(files.length).toBeGreaterThan(3);
    const report: string[] = [];
    for (const file of files) {
      const code = readFileSync(join(ROOT, file), "utf8");
      const scripts = file.endsWith(".html") ? [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!) : [code];
      for (const s of scripts) report.push(...scanHtmlSinks(s, file).map((f) => `${f.file}:${f.line} ${f.text}`));
    }
    expect(report).toEqual([]);
  });
});

describe("the scanner itself", () => {
  const rules = (code: string) => scanJs(code).map((f) => f.rule);

  test("catches every banned JS feature", () => {
    expect(rules("class A { x = 1; m() {} }")).toEqual(["class field"]);
    expect(rules("class A {\n  static y = 2\n  m() {}\n}")).toEqual(["class field"]);
    expect(rules("class A { #p() {} }")).toEqual(["private class member (#name)"]);
    expect(rules("await fetch('/x');")).toEqual(["top-level await"]);
    expect(rules("var x = list.at(-1);")).toEqual([".at() (Chromium 92, Safari 15.4)"]);
    expect(rules("var c = structuredClone(v);")).toEqual(["structuredClone() (Chromium 98, Safari 15.4)"]);
    expect(rules("if (Object.hasOwn(o, 'k')) {}")).toEqual(["Object.hasOwn() (Chromium 93, Safari 15.4)"]);
    expect(rules("var l = a.findLast(f);")).toEqual([".findLast() (Chromium 97, Safari 15.4)"]);
    expect(rules("var s = a.toSorted();")).toEqual(["change-array-by-copy methods (Chromium 110, Safari 16)"]);
    expect(rules("var r = new WeakRef(o);")).toEqual(["WeakRef (Safari 14.1)"]);
    expect(rules("var re = /(?<=a)b/;")).toEqual(["regex lookbehind (Safari 16.4)"]);
  });

  test("allows what the baseline has", () => {
    const ok = `
      import { html, reactive } from "/vendor/arrow/index.mjs";
      export function f() {}
      var a = b?.c ?? d;
      var o = { ...x, y: 1 };
      var { p, ...rest } = o;
      x ??= 1; y ||= 2;
      var m = import("./later.mjs");
      var s = "list.at(1) and #private in a string";
      var n = cond ? .5 : 1;
      var arr = [...list, 1];
      class A { constructor() { this.x = 1; } get y() { return 2; } static z() { return { a: 1 }; } m(a = 1) { return a; } }
      async function g() { await h(); }
      if (a) { b = 1; }
    `;
    expect(scanJs(ok)).toEqual([]);
  });

  test("catches banned CSS and allows the rest", () => {
    const bad = ".b{gap:4px}.d{aspect-ratio:1}:is(.e){}.e:has(.f){}.f{backdrop-filter:blur(2px)}.g{color:color-mix(in srgb,red,blue)}.j{row-gap:2px}.k{inset:0}.l{color:oklch(70% 0.1 200)}.m{height:100dvh}@container (min-width:1px){}.n:focus-visible{}@layer base{}";
    expect(scanCss(bad).map((f) => f.rule).sort()).toEqual([
      ":is(), :where() or :has()", ":is(), :where() or :has()", ":focus-visible", "@container or @layer", "@container or @layer",
      "aspect-ratio", "backdrop-filter", "color-mix()", "dynamic viewport units (dvh, svh, lvh)",
      "gap (flexbox gap is Safari 14.1; use grid-gap in a grid, or margins)", "gap (flexbox gap is Safari 14.1; use grid-gap in a grid, or margins)",
      "inset shorthand", "oklch(), lab() and other new colour functions",
    ].sort());
    const ok = "/* gap: 1px */ .a { display: grid; grid-template-columns: 1fr 2fr; grid-gap: 1vh; width: clamp(1px, 2vw, 3px); height: min(1vh, 2px); background: conic-gradient(red, blue); transform: translateX(1px); } .b { display: flex; } @keyframes k { from { opacity: 0 } }";
    expect(scanCss(ok)).toEqual([]);
  });

  test("checks HTML script and style blocks, allows module scripts and bans import maps", () => {
    const html = '<style>.a{gap:2px}</style><script type="module" src="x.mjs"></script><script type="importmap">{"imports":{}}</script><script type="module">var a = [].at(0);</script><div style="aspect-ratio: 1"></div>';
    expect(scanHtml(html).map((f) => f.rule).sort()).toEqual([
      ".at() (Chromium 92, Safari 15.4)", "aspect-ratio", "gap (flexbox gap is Safari 14.1; use grid-gap in a grid, or margins)", 'import map (type="importmap")',
    ].sort());
  });

  test("finds HTML sinks but not mentions in comments or strings", () => {
    const bad = "el.innerHTML = x; el.outerHTML = y; el.insertAdjacentHTML('beforeend', z); document.write(w); range.createContextualFragment(v);";
    expect(scanHtmlSinks(bad).length).toBe(5);
    expect(scanHtmlSinks('// never innerHTML\nvar s = "innerHTML"; el.textContent = s;')).toEqual([]);
  });
});
