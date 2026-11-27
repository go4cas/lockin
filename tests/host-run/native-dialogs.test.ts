// UI-41: the console, the display and the phone never use the browser's own alert(), confirm()
// or prompt(); every question goes through the design system's dialog (LockIn.nav.ask on the host).
// The one exception browsers force is the reload/close prompt (beforeunload), which is not a call.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../public");
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (statSync(p).isDirectory()) return name === "vendor" ? [] : files(p);
  return /\.(m?js|html)$/.test(name) ? [p] : [];
});

describe("no native dialogs (UI-41)", () => {
  test("no alert(), confirm() or prompt() calls in public/", () => {
    const hits: string[] = [];
    for (const f of files(root)) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\*|\/\*)/.test(line)) return;   // a comment line
        const code = line.replace(/\/\/.*$/, "");
        if (/(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/.test(code)) hits.push(`${f.slice(root.length + 1)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
