// TECH-SPEC 3.3: public/display/ and public/shared/ must run on Chromium 56 / Safari 11.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanCss, scanHtml, scanJs, type Finding } from "./helpers/baseline.ts";

const ROOT = join(import.meta.dir, "..");
const SCANNED = ["public/display", "public/shared"];

function scanFolder(folder: string): { files: string[]; findings: Finding[] } {
  if (!existsSync(join(ROOT, folder))) return { files: [], findings: [] };   // e.g. public/display/ before B6
  const files = [...new Bun.Glob("**/*.{js,css,html}").scanSync({ cwd: join(ROOT, folder), onlyFiles: true })].map((f) => `${folder}/${f}`);
  const findings: Finding[] = [];
  for (const file of files) {
    const code = readFileSync(join(ROOT, file), "utf8");
    if (file.endsWith(".js")) findings.push(...scanJs(code, file));
    else if (file.endsWith(".css")) findings.push(...scanCss(code, file));
    else findings.push(...scanHtml(code, file));
  }
  return { files, findings };
}

describe("Display browser baseline", () => {
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
});

describe("the scanner itself", () => {
  const rules = (code: string) => scanJs(code).map((f) => f.rule);

  test("catches every banned JS feature", () => {
    expect(rules("var a = b?.c;")).toEqual(["optional chaining (?.)"]);
    expect(rules("var a = b ?? c;")).toEqual(["nullish coalescing (??)"]);
    expect(rules("var a = { ...b, c: 1 };")).toEqual(["object spread or rest ({...x})"]);
    expect(rules("var { a, ...rest } = b;")).toEqual(["object spread or rest ({...x})"]);
    expect(rules("class A { x = 1; m() {} }")).toEqual(["class field"]);
    expect(rules("class A {\n  static y = 2\n  m() {}\n}")).toEqual(["class field"]);
    expect(rules("class A { #p() {} }")).toEqual(["private class member (#name)"]);
    expect(rules('import x from "y";')).toEqual(["import statement (modules)"]);
    expect(rules("export function f() {}")).toEqual(["export statement (modules)"]);
    expect(rules('var m = import("x");')).toEqual(["dynamic import()"]);
    expect(rules("await fetch('/x');")).toEqual(["top-level await"]);
  });

  test("allows what the baseline has", () => {
    const ok = `
      // a?.b and x ?? y in a comment
      var s = "a?.b ?? c { ...x }";
      var t = \`template ?? \${1}\`;
      var re = /a??b/g;
      var n = cond ? .5 : 1;
      var arr = [...list, 1];
      f(...args);
      class A { constructor() { this.x = 1; } get y() { return 2; } static z() { return { a: 1 }; } m(a = 1) { return a; } }
      async function g() { await h(); }
      var o = { a: 1, b: [1, 2], c: function () { return x == y; } };
      if (a) { b = 1; }
    `;
    expect(scanJs(ok)).toEqual([]);
  });

  test("catches banned CSS and allows the rest", () => {
    const bad = ".a{display:grid}.b{gap:4px}.c{width:clamp(1px,2vw,3px)}.d{aspect-ratio:1}:is(.e){}.f{backdrop-filter:blur(2px)}.g{color:color-mix(in srgb,red,blue)}.h{height:min(1vh,2px)}.i{grid-template-columns:1fr}.j{row-gap:2px}";
    expect(scanCss(bad).map((f) => f.rule).sort()).toEqual([
      ":is() or :where()", "CSS grid", "CSS grid", "aspect-ratio", "backdrop-filter", "clamp(), min() or max()", "clamp(), min() or max()",
      "color-mix()", "gap (flexbox or grid)", "gap (flexbox or grid)",
    ].sort());
    const ok = "/* display: grid */ .a { display: flex; min-width: 0; max-height: 10vh; width: calc(100% - 2vw); transform: translateX(1px); } @keyframes k { from { opacity: 0 } }";
    expect(scanCss(ok)).toEqual([]);
  });

  test("checks HTML script and style blocks and bans module scripts", () => {
    const html = '<style>.a{display:grid}</style><script type="module" src="x.js"></script><script>var a = b?.c;</script><div style="gap: 2px"></div>';
    expect(scanHtml(html).map((f) => f.rule).sort()).toEqual(["CSS grid", "gap (flexbox or grid)", 'module script (type="module")', "optional chaining (?.)"].sort());
  });
});
