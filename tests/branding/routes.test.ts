// B4 HTTP routes (TECH-SPEC 9.1, 9.2, 12.4) and the theme and venue stores (5.3, 5.4).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { branding } from "../../src/server/branding/index.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);
const WOFF2 = new Uint8Array([...new TextEncoder().encode("wOF2"), 0, 1, 0, 0]);
const TTF = new Uint8Array([0, 1, 0, 0, 0, 10, 0, 128]);
const SVG = new TextEncoder().encode('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode("<html><body>not a picture</body></html>");

let s: TestServer;
let cookie: string;

beforeAll(async () => {
  s = await startTestServer();
  cookie = await s.signIn();
});
afterAll(async () => { await s.stop(); });

async function upload(kind: string, bytes: Uint8Array, name = "file.bin"): Promise<Response> {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name));
  return s.fetch("/api/theme/assets", { method: "POST", body: form, cookie });
}

async function putTheme(theme: unknown): Promise<Response> {
  return s.fetch("/api/theme", { method: "PUT", cookie, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) });
}

describe("host routes need a session and a matching Origin", () => {
  for (const [method, path] of [["GET", "/api/theme"], ["PUT", "/api/theme"], ["POST", "/api/theme/assets"], ["GET", "/api/venue"], ["PUT", "/api/venue"], ["GET", "/api/theme/preview.css?theme=%7B%7D"]]) {
    test(`${method} ${path} answers 401 when signed out`, async () => {
      const res = await s.fetch(path!, { method, body: method === "GET" ? undefined : "{}" });
      expect(res.status).toBe(401);
    });
  }
  test("a PUT from another site is refused", async () => {
    const res = await s.fetch("/api/theme", { method: "PUT", cookie, origin: "https://evil.example", body: "{}" });
    expect(res.status).toBe(403);
  });
  test("/theme.css is public (phones and the display load it)", async () => {
    const res = await s.fetch("/theme.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("theme", () => {
  test("GET /api/theme gives the defaults, version and the bundled fonts", async () => {
    const body = await (await s.fetch("/api/theme", { cookie })).json();
    expect(body.theme.format).toBe("lockin.theme/1");
    expect(body.theme.colours).toEqual({ background: null, text: null, accent: null, accent2: null });
    expect(body.version).toMatch(/^[0-9a-f]{12}$/);
    expect(body.bundledFonts).toEqual([
      { id: "caveat-brush", name: "Caveat Brush" }, { id: "alfa-slab-one", name: "Alfa Slab One" },
      { id: "bebas-neue", name: "Bebas Neue" }, { id: "atkinson-hyperlegible", name: "Atkinson Hyperlegible" },
    ]);
  });

  test("PUT saves theme.json atomically in field order, and themeVersion and /theme.css change", async () => {
    const before = await (await s.fetch("/api/theme", { cookie })).json();
    const etagBefore = (await s.fetch("/theme.css")).headers.get("etag");
    const res = await putTheme({
      format: "lockin.theme/1", copy: {}, name: "The Example Arms",
      colours: { background: "#1C140F", text: "#f3e6cc", accent: "#d9a441", accent2: "#8cc2a8" },
      fonts: { display: { bundled: "alfa-slab-one" }, body: null },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).not.toBe(before.version);
    expect(branding(s.app).themeVersion()).toBe(body.version);
    expect(body.theme.colours.background).toBe("#1c140f");

    const file = readFileSync(join(s.dataDir, "theme", "theme.json"), "utf8");
    expect(Object.keys(JSON.parse(file))).toEqual(["format", "name", "logo", "colours", "fonts", "displayBackground", "copy"]);
    expect(file.endsWith("\n")).toBe(true);
    expect(existsSync(join(s.dataDir, "theme", "theme.json.tmp"))).toBe(false);

    const css = await (await s.fetch("/theme.css")).text();
    expect(css).toContain("--brand-bg: #1c140f;");
    expect(css).toContain("--brand-surface-2: #2d251e;");
    expect(css).toContain('"Alfa Slab One"');
    expect(css).toContain(`version ${body.version}`);
    expect((await s.fetch("/theme.css")).headers.get("etag")).not.toBe(etagBefore);
  });

  test("saving the same theme again keeps the version; a change makes a new one", async () => {
    const t = (await (await s.fetch("/api/theme", { cookie })).json()).theme;
    const v1 = (await (await putTheme(t)).json()).version;
    expect((await (await putTheme(t)).json()).version).toBe(v1);
    const v2 = (await (await putTheme({ ...t, name: "The Other Example" })).json()).version;
    expect(v2).not.toBe(v1);
  });

  test("onThemeChange tells other modules about a save", async () => {
    const seen: string[] = [];
    branding(s.app).onThemeChange((_t, v) => seen.push(v));
    const res = await (await putTheme({ format: "lockin.theme/1", name: "Listener Test" })).json();
    expect(seen).toEqual([res.version]);
  });

  test("an invalid theme is refused with plain-English problems, and nothing is written", async () => {
    const before = readFileSync(join(s.dataDir, "theme", "theme.json"), "utf8");
    const res = await putTheme({ format: "lockin.theme/1", colours: { background: "red" }, fonts: { body: { bundled: "bebas-neue" } } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid");
    expect(body.error.problems.map((p: { path: string }) => p.path)).toEqual(["colours.background", "fonts.body"]);
    expect(readFileSync(join(s.dataDir, "theme", "theme.json"), "utf8")).toBe(before);
  });

  test("a theme naming an asset that was never uploaded is refused", async () => {
    const res = await putTheme({ format: "lockin.theme/1", logo: "assets/logo-0000000000.png" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.problems[0].path).toBe("logo");
  });

  test("a body without { theme } is a 400", async () => {
    const res = await s.fetch("/api/theme", { method: "PUT", cookie, body: JSON.stringify({ format: "lockin.theme/1" }) });
    expect(res.status).toBe(400);
  });
});

describe("asset uploads (12.4)", () => {
  test("a PNG logo is stored under a generated name and served with the upload CSP", async () => {
    const res = await upload("logo", PNG, "../../evil name.png");
    expect(res.status).toBe(200);
    const { file } = await res.json();
    expect(file).toMatch(/^assets\/logo-[0-9a-f]{10}\.png$/);
    const served = await s.fetch(`/theme/${file}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
    // The same file again gives the same name.
    expect((await (await upload("logo", PNG)).json()).file).toBe(file);
    // And a theme may now use it.
    expect((await putTheme({ format: "lockin.theme/1", logo: file })).status).toBe(200);
  });

  test("an SVG logo is accepted and served as image/svg+xml in a sandbox", async () => {
    const { file } = await (await upload("logo", SVG, "logo.svg")).json();
    expect(file).toMatch(/\.svg$/);
    const served = await s.fetch(`/theme/${file}`);
    expect(served.headers.get("content-type")).toBe("image/svg+xml");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
  });

  test("types are checked by the first bytes, not the name", async () => {
    const res = await upload("logo", HTML, "logo.png");
    expect(res.status).toBe(415);
    expect((await res.json()).error.message).toBe("The logo must be a PNG, SVG or JPEG file.");
    expect((await upload("logo", WEBP, "x.webp")).status).toBe(415);            // WebP is not a logo type
    expect((await upload("displayBackground", SVG, "x.svg")).status).toBe(415); // no SVG backgrounds
    expect((await upload("font", PNG, "x.woff2")).status).toBe(415);
  });

  test("each kind takes its own types", async () => {
    for (const [kind, bytes, ext] of [["logo", JPEG, "jpg"], ["displayBackground", WEBP, "webp"], ["displayBackground", JPEG, "jpg"], ["font", WOFF2, "woff2"], ["font", TTF, "ttf"]] as const) {
      const res = await upload(kind, bytes);
      expect(res.status).toBe(200);
      expect((await res.json()).file).toEndWith(`.${ext}`);
    }
  });

  test("size limits: logo and fonts 2 MB, background 5 MB", async () => {
    const big = (n: number, head: Uint8Array) => { const b = new Uint8Array(n); b.set(head); return b; };
    expect((await upload("logo", big(2 * 1024 * 1024 + 1, PNG))).status).toBe(413);
    expect((await upload("font", big(2 * 1024 * 1024 + 1, WOFF2))).status).toBe(413);
    expect((await upload("displayBackground", big(3 * 1024 * 1024, JPEG))).status).toBe(200);
    expect((await upload("displayBackground", big(5 * 1024 * 1024 + 1, JPEG))).status).toBe(413);
  });

  test("an unknown kind, a missing file or an empty file is a 400", async () => {
    expect((await upload("favicon", PNG)).status).toBe(400);
    expect((await upload("logo", new Uint8Array(0))).status).toBe(400);
    const form = new FormData();
    form.append("kind", "logo");
    expect((await s.fetch("/api/theme/assets", { method: "POST", body: form, cookie })).status).toBe(400);
  });

  test("asset names that could leave the folder are not served", async () => {
    for (const p of ["/theme/assets/..%2Ftheme.json", "/theme/assets/.hidden", "/theme/assets/nothing.png"]) {
      expect((await s.fetch(p)).status).toBe(404);
    }
  });
});

describe("preview.css (H-16)", () => {
  test("gives scoped CSS for an unsaved theme", async () => {
    const theme = { format: "lockin.theme/1", colours: { background: "#0e0b1a" }, fonts: { display: { bundled: "bebas-neue" } } };
    const res = await s.fetch(`/api/theme/preview.css?theme=${encodeURIComponent(JSON.stringify(theme))}`, { cookie });
    expect(res.status).toBe(200);
    const css = await res.text();
    expect(css).toContain(".lockin-preview {");
    expect(css).toContain("--brand-bg: #0e0b1a;");
    expect(css).not.toContain(":root");
  });
  test("an invalid theme gives a 400 with a CSS comment", async () => {
    const res = await s.fetch(`/api/theme/preview.css?theme=${encodeURIComponent('{"format":"lockin.theme/1","colours":{"text":"url(x)"}}')}`, { cookie });
    expect(res.status).toBe(400);
    expect(await res.text()).toStartWith("/*");
  });
});

describe("venue settings (5.4)", () => {
  test("GET gives the defaults", async () => {
    const t = await startTestServer();
    try {
      const c = await t.signIn();
      expect(await (await t.fetch("/api/venue", { cookie: c })).json()).toEqual({
        format: "lockin.venue/1", prizes: [], holding: { minutesBefore: 30, panels: ["countdown", "teams", "join", "install", "animation", "prizes"] },
      });
    } finally { await t.stop(); }
  });

  test("PUT saves prizes in place order, holding minutes and panels; unknown panels are dropped", async () => {
    const res = await s.fetch("/api/venue", {
      method: "PUT", cookie,
      body: JSON.stringify({ format: "lockin.venue/1", prizes: [{ place: 2, text: "A round of shots" }, { place: 1, text: "R300 bar tab" }], holding: { minutesBefore: 45, panels: ["join", "prizes", "fireworks"] } }),
    });
    expect(res.status).toBe(200);
    const saved = { format: "lockin.venue/1", prizes: [{ place: 1, text: "R300 bar tab" }, { place: 2, text: "A round of shots" }], holding: { minutesBefore: 45, panels: ["join", "prizes"] } };
    expect(await res.json()).toEqual(saved);
    expect(JSON.parse(readFileSync(join(s.dataDir, "venue.json"), "utf8"))).toEqual(saved);
    expect(await (await s.fetch("/api/venue", { cookie })).json()).toEqual(saved);
    expect(branding(s.app).venue()).toEqual(saved as never);
  });

  test("bad values and two prizes for one place are refused", async () => {
    const bad = await s.fetch("/api/venue", { method: "PUT", cookie, body: JSON.stringify({ format: "lockin.venue/1", holding: { minutesBefore: 121 } }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.problems[0].path).toBe("holding.minutesBefore");
    const dup = await s.fetch("/api/venue", { method: "PUT", cookie, body: JSON.stringify({ format: "lockin.venue/1", prizes: [{ place: 1, text: "a" }, { place: 1, text: "b" }] }) });
    expect(dup.status).toBe(400);
    expect((await dup.json()).error.message).toBe("There are two prizes for place 1.");
  });
});

describe("files on disk are the source of truth (S-09, 4.4)", () => {
  test("a broken theme.json is logged, the defaults are used, and the file is left alone", async () => {
    const t = await startTestServer();
    try {
      mkdirSync(join(t.dataDir, "theme"), { recursive: true });
      writeFileSync(join(t.dataDir, "theme", "theme.json"), JSON.stringify({ format: "lockin.theme/9" }));
      const css = await (await t.fetch("/theme.css")).text();
      expect(css).toContain("--brand-bg: #17191b;");
      expect(t.logs.some((l) => l.includes("theme.json has problems"))).toBe(true);
      const c = await t.signIn();
      const body = await (await t.fetch("/api/theme", { cookie: c })).json();
      expect(body.problems[0].path).toBe("format");
      expect(readFileSync(join(t.dataDir, "theme", "theme.json"), "utf8")).toContain("lockin.theme/9");
    } finally { await t.stop(); }
  });

  test("a theme copied in by hand is picked up without a restart", async () => {
    const t = await startTestServer();
    try {
      const v1 = branding(t.app).themeVersion();
      mkdirSync(join(t.dataDir, "theme"), { recursive: true });
      writeFileSync(join(t.dataDir, "theme", "theme.json"), JSON.stringify({ format: "lockin.theme/1", name: "Copied In", colours: { accent: "#123456" } }));
      expect(await (await t.fetch("/theme.css")).text()).toContain("--brand-accent: #123456;");
      expect(branding(t.app).venueName()).toBe("Copied In");
      expect(branding(t.app).themeVersion()).not.toBe(v1);
    } finally { await t.stop(); }
  });
});
