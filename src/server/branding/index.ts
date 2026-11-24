// B4: venue theme, venue settings, /theme.css and the copy pools
// (TECH-SPEC 5.3 to 5.5, 8.6, 9; docs/design/branding.md).
//
// Other modules reach the stores through branding(app):
//   branding(app).theme(), .themeVersion(), .venueName(), .venue(), .onThemeChange(fn)
// and the copy picker through app.services.copyPicker.

import type { App } from "../app.ts";
import { BUNDLED_FONTS, validateTheme } from "../../shared/formats.ts";
import { UPLOAD_CSP, errorResponse, json, readJsonBody } from "../http.ts";
import { BUNDLED_FONT_INFO } from "./derive.ts";
import { ASSET_KINDS, ASSET_RULES, type AssetKind } from "./assets.ts";
import { createCopyPicker, mergePools, poolsFromCopyFile, type Pools } from "./copy.ts";
import { BrandingStore } from "./store.ts";
import { themeCss } from "./theme-css.ts";

export { BrandingStore } from "./store.ts";

/** The default copy pools, a shipped file (embedded in the binary, TECH-SPEC 4.6). */
export const COPY_PATH = "docs/brand/copy.en.json";

const stores = new WeakMap<App, BrandingStore>();

/** The branding store of an app. B1 reads the venue name, theme version and venue defaults here. */
export function branding(app: App): BrandingStore {
  let s = stores.get(app);
  if (!s) {
    s = new BrandingStore(app.config.dataDir, (m) => app.log(m));
    stores.set(app, s);
  }
  return s;
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf",
};

function cssResponse(req: Request, css: string): Response {
  const etag = `"${Bun.hash(css).toString(16)}"`;
  const headers = { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache", ETag: etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(req.method === "HEAD" ? null : css, { headers });
}

function problemsResponse(problems: { path: string; message: string }[]): Response {
  return Response.json({ error: { code: "invalid", message: problems[0]?.message ?? "Those settings are not valid.", problems } }, { status: 400 });
}

export function register(app: App): void {
  const store = branding(app);

  // Default copy pools, read through app.files so the compiled binary finds its
  // embedded copy (B8). The theme's copy is merged on every pick.
  let defaults: Pools = {};
  const copyLoaded = app.files.read(COPY_PATH).then((bytes) => {
    if (!bytes) { app.log(`${COPY_PATH} is missing, so screens show no copy lines.`); return; }
    try {
      defaults = poolsFromCopyFile(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) {
      app.log(`${COPY_PATH} could not be read, so screens show no copy lines: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  app.services.copyPicker = createCopyPicker(() => mergePools(defaults, store.theme().copy), () => store.venueName());

  // Start-up (4.4): load both files now so problems show in the log at start.
  app.onStart(async () => {
    await copyLoaded;
    store.theme();
    store.venue();
  });

  // --- public: the theme for every page ------------------------------------

  app.route("GET", "/theme.css", (req) => cssResponse(req, themeCss(store.theme(), { version: store.themeVersion() })));

  app.route("GET", "/theme/assets/:file", async (req, ctx) => {
    const path = store.assetPath(ctx.params.file ?? "");
    if (!path) return errorResponse(404, "not_found", "There is no such file.");
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const etag = `"${Bun.hash(bytes).toString(16)}"`;
    const ext = path.split(".").pop() ?? "";
    const headers = {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Security-Policy": UPLOAD_CSP,
      "Cache-Control": "no-cache",
      ETag: etag,
    };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(req.method === "HEAD" ? null : bytes, { headers });
  });

  // --- host API (9.2) ---------------------------------------------------------

  const bundledFonts = BUNDLED_FONTS.map((id) => ({ id, name: BUNDLED_FONT_INFO.find((f) => f.id === id)?.family ?? id }));

  app.route("GET", "/api/theme", () => json({ theme: store.theme(), version: store.themeVersion(), bundledFonts, problems: store.themeProblems() }), { host: true });

  app.route("PUT", "/api/theme", async (req) => {
    const body = await readJsonBody(req);
    if (!body || !("theme" in body)) return errorResponse(400, "bad_request", "Send the theme as { \"theme\": ... }.");
    const v = store.saveTheme(body.theme);
    if (!v.ok) return problemsResponse(v.problems);
    return json({ theme: v.value, version: store.themeVersion() });
  }, { host: true });

  app.route("POST", "/api/theme/assets", async (req) => {
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > 6 * 1024 * 1024) return errorResponse(413, "too_big", "That file is too big. Logos and fonts can be up to 2 MB, pictures up to 5 MB.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return errorResponse(400, "bad_request", "Send the file as a form upload.");
    }
    const kind = form.get("kind");
    if (typeof kind !== "string" || !(ASSET_KINDS as readonly string[]).includes(kind)) {
      return errorResponse(400, "bad_request", "Say whether the file is the logo, the display background or a font.");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") return errorResponse(400, "bad_request", "No file was sent.");
    if (file.size > ASSET_RULES[kind as AssetKind].maxBytes) {
      const rule = ASSET_RULES[kind as AssetKind];
      return errorResponse(413, "too_big", `The ${rule.label} must be ${rule.maxBytes / (1024 * 1024)} MB or smaller.`);
    }
    const saved = store.saveAsset(kind as AssetKind, new Uint8Array(await file.arrayBuffer()));
    if (!saved.ok) return errorResponse(saved.status, saved.code, saved.message);
    return json({ file: saved.file });
  }, { host: true });

  app.route("GET", "/api/venue", () => json(store.venue()), { host: true });

  app.route("PUT", "/api/venue", async (req) => {
    const body = await readJsonBody(req);
    if (!body) return errorResponse(400, "bad_request", "Send the venue settings as JSON.");
    const v = store.saveVenue(body);
    if (!v.ok) return problemsResponse(v.problems);
    return json(v.value);
  }, { host: true });

  // Live preview (H-16): the CSS for an unsaved theme, scoped to the preview so it never restyles the console.
  app.route("GET", "/api/theme/preview.css", (req, ctx) => {
    const raw = ctx.url.searchParams.get("theme");
    let parsed: unknown;
    try {
      parsed = raw === null ? null : JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const v = validateTheme(parsed);
    if (!v.ok) {
      return new Response(`/* This theme is not valid: ${v.problems.map((p) => p.message).join(" ").replace(/\*\//g, "")} */\n`, {
        status: 400, headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }
    return cssResponse(req, themeCss(v.value, { selector: ".lockin-preview", familyPrefix: "Lock-In Preview" }));
  }, { host: true });
}
