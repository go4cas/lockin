import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PAGE_CSP, Router } from "../../src/server/http.ts";
import { TOKENS_PATH, safeRelative, staticPath } from "../../src/server/static.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

let s: TestServer;
let cookie: string;
beforeAll(async () => {
  s = await startTestServer();
  cookie = await s.signIn();
});
afterAll(async () => { await s.stop(); });

describe("GET /api/ping", () => {
  test("answers app and version", async () => {
    const res = await s.fetch("/api/ping");
    expect(await res.json()).toEqual({ app: "lockin", version: s.app.version });
  });
});

describe("security headers (TECH-SPEC 12.4)", () => {
  test("every response has nosniff and no-referrer", async () => {
    for (const path of ["/api/ping", "/static/shared/base.css", "/nothing-here", "/host/login"]) {
      const res = await s.fetch(path);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  test("pages get the page CSP; other responses do not need it", async () => {
    const page = await s.fetch("/host", { cookie });
    expect(page.headers.get("content-type")).toStartWith("text/html");
    expect(page.headers.get("content-security-policy")).toBe(PAGE_CSP);
    const css = await s.fetch("/static/shared/base.css");
    expect(css.headers.get("content-security-policy")).toBeNull();
  });

  test("mutating requests need an Origin equal to the public URL", async () => {
    const body = JSON.stringify({ password: "x" });
    expect((await s.fetch("/api/auth/login", { method: "POST", body, origin: null })).status).toBe(403);
    expect((await s.fetch("/api/auth/login", { method: "POST", body, origin: "https://evil.example.com" })).status).toBe(403);
    expect((await s.fetch("/api/auth/login", { method: "POST", body })).status).toBe(401);  // allowed through, wrong password
  });

  test("errors are JSON with a plain-English message", async () => {
    const res = await s.fetch("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "There is nothing at this address." } });
    const res2 = await s.fetch("/api/ping", { method: "DELETE" });
    expect(res2.status).toBe(405);
  });
});

describe("static files (TECH-SPEC 9.1, 4.5)", () => {
  test("serves public/ with no-cache and an ETag, and 304 when unchanged", async () => {
    const res = await s.fetch("/static/shared/ws-client.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag")!;
    expect(await res.text()).toBe(readFileSync("public/shared/ws-client.js", "utf8"));
    const again = await s.fetch("/static/shared/ws-client.js", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
  });

  test("/static/shared/tokens.css is Design's assets/tokens.css", async () => {
    const res = await s.fetch("/static/shared/tokens.css");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(readFileSync(TOKENS_PATH, "utf8"));
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  test("the Funnel fonts, their licences and the Lock-In logo are served from assets/", async () => {
    const font = await s.fetch("/static/fonts/funnel-display-wght.woff2");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(new Uint8Array(await font.arrayBuffer())).toEqual(new Uint8Array(readFileSync("assets/fonts/funnel-display-wght.woff2")));
    expect((await s.fetch("/static/fonts/funnel-sans-wght.woff2")).status).toBe(200);
    expect((await s.fetch("/static/fonts/OFL-funnel-sans.txt")).status).toBe(200);
    const logo = await s.fetch("/static/logo/lockin-favicon.svg");
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/svg+xml");
  });

  test("refuses paths that leave public/", async () => {
    for (const path of ["/static/../package.json", "/static/%2e%2e/package.json", "/static/shared/..%2f..%2fpackage.json", "/static/.hidden", "/static/shared%5c..%5cpackage.json"]) {
      const res = await s.fetch(path);
      expect(res.status).toBe(404);
    }
    expect(safeRelative("a/../b")).toBeNull();
    expect(safeRelative("a\\b")).toBeNull();
    expect(safeRelative("shared/base.css")).toBe("shared/base.css");
    expect(staticPath("fonts/funnel-sans-wght.woff2")).toBe("assets/fonts/funnel-sans-wght.woff2");
  });

  test("missing files are 404", async () => {
    expect((await s.fetch("/static/shared/nothing.js")).status).toBe(404);
  });
});

describe("host console pages (TECH-SPEC 9.1, S-03)", () => {
  test("signed out: /host and its sections redirect to login", async () => {
    for (const path of ["/host", "/host/build", "/host/brand", "/host/run", "/host/history", "/host/how"]) {
      const res = await s.fetch(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/host/login?next=${encodeURIComponent(path)}`);
    }
  });

  test("signed in: the shell and every section page load, with navigation", async () => {
    for (const path of ["/host", "/host/build", "/host/brand", "/host/run", "/host/history", "/host/how"]) {
      const res = await s.fetch(path, { cookie });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="host-nav"');
      expect(html).toContain("/static/host/nav.js");
    }
    expect((await s.fetch("/host/unknown", { cookie })).status).toBe(404);
  });

  test("login page redirects a signed-in host to the console; setup redirects to login once set", async () => {
    expect((await s.fetch("/host/login")).status).toBe(200);
    expect((await s.fetch("/host/login", { cookie })).headers.get("location")).toBe("/host");
    expect((await s.fetch("/host/setup")).headers.get("location")).toBe("/host/login");
  });

  test("before a password is set, everything goes to the setup page", async () => {
    const fresh = await startTestServer();
    try {
      for (const path of ["/host", "/host/run", "/host/login"]) {
        expect((await fresh.fetch(path)).headers.get("location")).toBe("/host/setup");
      }
      const setup = await fresh.fetch("/host/setup");
      expect(setup.status).toBe(200);
      expect(await setup.text()).toContain('id="setup-code"');
    } finally {
      await fresh.stop();
    }
  });
});

describe("Router", () => {
  test("literal segments beat params, params beat *", () => {
    const r = new Router();
    const h = (name: string) => () => new Response(name);
    r.add("GET", "/a/*", h("star"));
    r.add("GET", "/a/:id", h("param"));
    r.add("GET", "/a/new", h("literal"));
    const pick = (p: string) => { const m = r.match("GET", p); return m && m !== "method" ? m : null; };
    expect(pick("/a/new")!.route.parts).toEqual(["a", "new"]);
    expect(pick("/a/x")!.params).toEqual({ id: "x" });
    expect(pick("/a/x/y")!.params).toEqual({ "*": "x/y" });
    expect(r.match("POST", "/a/x")).toBe("method");
    expect(r.match("GET", "/b")).toBeNull();
    expect(() => r.add("GET", "/a/new", h("again"))).toThrow("registered twice");
  });
});
