// B7: the phone pages, manifest and service worker routes (TECH-SPEC 9.1, P-10).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml, manifest, personalise } from "../../src/server/phone/index.ts";
import { defaultTheme } from "../../src/shared/formats.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

const ROOT = join(import.meta.dir, "../..");
let s: TestServer;

beforeAll(async () => { s = await startTestServer(); });
afterAll(async () => { await s.stop(); });

describe("phone pages", () => {
  for (const path of ["/", "/j/BKTW", "/m/K7PX3M2A"]) {
    test(`GET ${path} serves the phone app with the page security headers`, async () => {
      const res = await s.fetch(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.text();
      expect(body).toContain('<script type="module" src="/static/phone/app.mjs"></script>');
      expect(body).toContain('<link rel="manifest" href="/manifest.webmanifest">');
      expect(body).toContain("<title>Lock-In</title>");
    });
  }

  test("the phone's own files are served from /static/phone/", async () => {
    for (const f of ["app.mjs", "state.mjs", "screens.mjs", "logic.mjs", "phone.css", "icons/icon-192.png"]) {
      const res = await s.fetch(`/static/phone/${f}`);
      expect(res.status, f).toBe(200);
    }
    expect((await s.fetch("/static/phone/app.mjs")).headers.get("content-type")).toContain("text/javascript");
  });

  test("GET /sw.js serves the service worker from the root", async () => {
    const res = await s.fetch("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("service-worker-allowed")).toBe("/");
    expect(await res.text()).toContain("lockin-phone-");
  });
});

describe("manifest", () => {
  test("without a theme: Lock-In's name and icons, standalone, starts at /", async () => {
    const res = await s.fetch("/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const m = await res.json();
    expect(m.name).toBe("Lock-In");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    for (const icon of m.icons) expect((await s.fetch(icon.src)).status).toBe(200);
  });

  test("with a theme: the venue's name, logo and background colour", async () => {
    mkdirSync(join(s.dataDir, "theme"), { recursive: true });
    writeFileSync(join(s.dataDir, "theme", "theme.json"), JSON.stringify({
      ...defaultTheme(), name: "The Example Arms", logo: "assets/logo-1a2b.png",
      colours: { background: "#102030", text: null, accent: null, accent2: null },
    }));
    const m = await (await s.fetch("/manifest.webmanifest")).json();
    expect(m.name).toBe("The Example Arms");
    expect(m.short_name).toBe("The Example");
    expect(m.background_color).toBe("#102030");
    expect(m.icons[0]).toEqual({ src: "/theme/assets/logo-1a2b.png", sizes: "512x512", type: "image/png", purpose: "any" });
    const page = await (await s.fetch("/j/BKTW")).text();
    expect(page).toContain("<title>The Example Arms</title>");
    expect(page).toContain('<meta name="apple-mobile-web-app-title" content="The Example Arms">');
    expect(page).toContain('<link rel="apple-touch-icon" href="/theme/assets/logo-1a2b.png">');
    expect(page).toContain('<meta name="theme-color" content="#102030">');
  });

  test("a broken theme file falls back to Lock-In", async () => {
    writeFileSync(join(s.dataDir, "theme", "theme.json"), "{ not json");
    expect((await (await s.fetch("/manifest.webmanifest")).json()).name).toBe("Lock-In");
  });

  test("an SVG logo goes in the manifest but not as the iPhone icon", () => {
    const theme = { ...defaultTheme(), name: "X", logo: "assets/logo.svg" };
    expect((manifest(theme).icons as { sizes: string }[])[0]!.sizes).toBe("any");
    const page = readFileSync(join(ROOT, "public/phone/index.html"), "utf8");
    expect(personalise(page, theme)).toContain('href="/static/phone/icons/apple-touch-icon.png"');
  });

  test("the venue name is escaped in the page", () => {
    const page = readFileSync(join(ROOT, "public/phone/index.html"), "utf8");
    const out = personalise(page, { ...defaultTheme(), name: `Bob's <b>"Bar"</b> & Grill` });
    expect(out).toContain("<title>Bob&#39;s &lt;b&gt;&quot;Bar&quot;&lt;/b&gt; &amp; Grill</title>");
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("the placeholders personalise() replaces are all in the page", () => {
    const page = readFileSync(join(ROOT, "public/phone/index.html"), "utf8");
    for (const s of ["<title>Lock-In</title>", '<meta name="apple-mobile-web-app-title" content="Lock-In">',
      '<link rel="apple-touch-icon" href="/static/phone/icons/apple-touch-icon.png">', '<meta name="theme-color" content="#17191b">']) {
      expect(page).toContain(s);
    }
  });
});

describe("service worker app shell", () => {
  const sw = readFileSync(join(ROOT, "public/phone/sw.js"), "utf8");
  const shell = [...sw.matchAll(/^\s+"(\/[^"]*)",?$/gm)].map((m) => m[1]!);

  test("lists the phone's files", () => {
    expect(shell).toContain("/static/phone/app.mjs");
    expect(shell).toContain("/vendor/arrow/index.mjs");
  });

  test("every shell file exists (the cache never holds a 404)", () => {
    const vendorChunk = readFileSync(join(ROOT, "public/vendor/arrow/index.mjs"), "utf8").match(/chunks\/(internal-[\w-]+\.mjs)/)![1];
    expect(shell).toContain(`/vendor/arrow/chunks/${vendorChunk}`);
    for (const url of shell) {
      if (url === "/") continue;
      const file = url.startsWith("/vendor/") ? join(ROOT, "public", url)
        : url.startsWith("/static/fonts/") ? join(ROOT, "docs/design/fonts", url.slice(14).replace(/^([a-z-]+)\.woff2$/, "$1-400.woff2"))
        : url.startsWith("/static/logo/") ? join(ROOT, "docs/design/logo", url.slice(13))
        : url === "/static/shared/tokens.css" ? join(ROOT, "docs/design/tokens.css")
        : join(ROOT, "public", url.slice(8));
      expect(existsSync(file), url).toBe(true);
    }
  });

  test("every module the phone page imports is in the shell", () => {
    const dir = join(ROOT, "public/phone");
    for (const f of ["app.mjs", "state.mjs", "screens.mjs"]) {
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/from "\.\/([\w.-]+)"/g)) expect(shell).toContain(`/static/phone/${m[1]}`);
    }
  });

  test("never handles the WebSocket, the API, media, the display or the host", () => {
    expect(sw).not.toMatch(/"\/(ws|api|media|display|host)/);
    expect(sw).toContain('if (req.method !== "GET") return;');
  });
});
