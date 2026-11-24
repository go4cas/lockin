// Owned by B6 (display). GET /display serves the display page, no sign-in (T-01, TECH-SPEC 9.1).
// Its scripts and styles load from /static/display/, /static/shared/ and /vendor/arrow/.

import type { App } from "../app.ts";
import { serveFile } from "../static.ts";

export const DISPLAY_PAGE = "public/display/index.html";

export function register(app: App): void {
  app.route("GET", "/display", async (req) =>
    (await serveFile(req, app.files, DISPLAY_PAGE)) ??
    new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
}
