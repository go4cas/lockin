// B6: the display page, its browser check and its route.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startTestServer, type TestServer } from "../helpers/server.ts";

const ROOT = join(import.meta.dir, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("public/display/index.html", () => {
  const page = read("public/display/index.html");

  test("loads the default theme, the venue theme and the display styles", () => {
    expect(page).toContain('href="/static/shared/tokens.css"');
    expect(page).toContain('href="/theme.css"');
    expect(page.indexOf("/static/shared/tokens.css")).toBeLessThan(page.indexOf("/theme.css"));
    expect(page).toContain('href="/static/display/display.css"');
  });

  test("runs check.js first, as a classic script, then the shared scripts, then the Arrow module", () => {
    const scripts = [...page.matchAll(/<script([^>]*)>/g)].map((m) => m[1]!.trim());
    expect(scripts).toEqual([
      'src="/static/display/check.js"',
      'src="/static/shared/clock.js"',
      'src="/static/shared/ws-client.js"',
      'src="/static/shared/view.js"',
      'type="module" src="/static/display/display.mjs"',
    ]);
  });

  test("has no inline script (the page CSP allows only 'self')", () => {
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });

  test("the module imports Arrow by absolute path, with no import map (TECH-SPEC 3.4)", () => {
    const mod = read("public/display/display.mjs");
    expect(mod).toContain('from "/vendor/arrow/index.mjs"');
    expect(page).not.toContain("importmap");
  });

  test("shows the Powered by Lock-In credit and the reconnecting badge (T-10, T-11)", () => {
    const mod = read("public/display/display.mjs");
    expect(mod).toContain("Powered by <b>Lock-In</b>");
    expect(mod).toContain("Reconnecting…");
  });
});

describe("public/display/check.js (T-01: browser too old)", () => {
  const code = read("public/display/check.js");

  test("is plain ES5 with no eval, so any TV browser can run it", () => {
    const body = code.replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const banned of [/\blet\s/, /\bconst\s/, /=>/, /`/, /\bclass\s/, /\.\.\./, /\beval\s*\(/, /new Function/]) {
      expect(body).not.toMatch(banned);
    }
  });

  type Check = { supported(win: unknown): boolean };
  function load(): Check {
    const scope: { LockInDisplayCheck?: Check } = {};
    new Function(code).call(scope);   // no document: only defines LockInDisplayCheck
    return scope.LockInDisplayCheck!;
  }
  const win = (opts: { modules: boolean; replace: boolean }) => ({
    document: {},
    HTMLScriptElement: { prototype: opts.modules ? { noModule: false } : {} },
    Element: { prototype: opts.replace ? { replaceChildren() {} } : {} },
  });

  test("passes a browser with modules and replaceChildren (Chromium 86 / Safari 14)", () => {
    expect(load().supported(win({ modules: true, replace: true }))).toBe(true);
  });

  test("fails one without replaceChildren or without modules", () => {
    expect(load().supported(win({ modules: true, replace: false }))).toBe(false);
    expect(load().supported(win({ modules: false, replace: true }))).toBe(false);
  });

  test("the message names the fix in plain English", () => {
    expect(code).toContain("This TV's browser is too old for Lock-In");
    expect(code).toContain("laptop plugged in with HDMI");
    expect(code).toContain("Chromecast");
  });
});

describe("GET /display (TECH-SPEC 9.1)", () => {
  let s: TestServer;
  beforeAll(async () => { s = await startTestServer(); });
  afterAll(() => s.stop());

  test("serves the display page with no sign-in, with the page CSP", async () => {
    const res = await s.fetch("/display", { origin: null });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await res.text()).toContain('<div id="display">');
  });

  test("its scripts and styles are served from /static/display/", async () => {
    for (const f of ["check.js", "display.mjs", "logic.mjs", "display.css", "fonts.css"]) {
      const res = await s.fetch(`/static/display/${f}`, { origin: null });
      expect(res.status).toBe(200);
    }
  });
});
