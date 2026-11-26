// B4: venue theme, venue settings, /theme.css and the copy pools
// (TECH-SPEC 5.3 to 5.5, 8.6, 9; docs/DESIGN-SYSTEM.md).
//
// The store and the copy picker are built by the composition root (services.ts,
// code review LI-020); other modules use app.services.branding and
// app.services.copyPicker.

import type { App } from "../app.ts";
import { COUNTDOWN_STYLES, validateTheme } from "../../shared/formats.ts";
import { UPLOAD_CSP, errorResponse, json, BodyTooLarge, readFormBody, readJsonBody } from "../http.ts";
import { ASSET_KINDS, ASSET_RULES, type AssetKind } from "./assets.ts";
import { themeCss } from "./theme-css.ts";

export { BrandingStore } from "./store.ts";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
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
  const store = app.services.branding;

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

  app.route("GET", "/api/theme", () => json({ theme: store.theme(), version: store.themeVersion(), countdownStyles: COUNTDOWN_STYLES, problems: store.themeProblems() }), { host: true });

  app.route("PUT", "/api/theme", async (req) => {
    const body = await readJsonBody(req);
    if (!body || !("theme" in body)) return errorResponse(400, "bad_request", "Send the theme as { \"theme\": ... }.");
    const v = store.saveTheme(body.theme);
    if (!v.ok) return problemsResponse(v.problems);
    return json({ theme: v.value, version: store.themeVersion() });
  }, { host: true });

  app.route("POST", "/api/theme/assets", async (req) => {
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > 6 * 1024 * 1024) return errorResponse(413, "too_big", "That file is too big. Logos can be up to 2 MB, pictures up to 5 MB.");
    // Counted while it is read, so a chunked body is stopped at the limit too (SA-02).
    let form: FormData | null;
    try {
      form = await readFormBody(req, 6 * 1024 * 1024);
    } catch (e) {
      if (!(e instanceof BodyTooLarge)) throw e;
      return errorResponse(413, "too_big", "That file is too big. Logos can be up to 2 MB, pictures up to 5 MB.");
    }
    if (!form) return errorResponse(400, "bad_request", "Send the file as a form upload.");
    const kind = form.get("kind");
    if (typeof kind !== "string" || !(ASSET_KINDS as readonly string[]).includes(kind)) {
      return errorResponse(400, "bad_request", "Say whether the file is the logo or the display background picture.");
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
      // SA-19: nothing from the request is echoed (the branding page validates with PUT /api/theme).
      return new Response("/* This theme is not valid. */\n", {
        status: 400, headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }
    return cssResponse(req, themeCss(v.value, { selector: ".lockin-preview" }));
  }, { host: true });
}
