// Owned by B7 (team phone and web app). Serves the phone pages, the web app
// manifest and the service worker (TECH-SPEC 9.1):
//   GET /, /j/:roomCode, /m/:moveCode   the phone app (one page; it reads its own URL)
//   GET /manifest.webmanifest           venue name and logo from the theme file (P-10)
//   GET /sw.js                          service worker, served from the root so it may cover "/"

import type { ThemeFile } from "../../shared/formats.ts";
import type { App } from "../app.ts";
import { serveFile } from "../static.ts";

export const PHONE_PAGE = "public/phone/index.html";
export const SERVICE_WORKER = "public/phone/sw.js";
const DEFAULT_NAME = "Lock-In";
const DEFAULT_BG = "#17191b";   // --brand-bg in docs/design/tokens.css

/** Escapes text for an HTML attribute or text node. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The venue logo's public URL, if the theme has one in its assets folder (served by B4 at /theme/assets/). */
function logoUrl(theme: ThemeFile | null): { url: string; type: string } | null {
  const m = theme?.logo ? /^assets\/([A-Za-z0-9._-]+\.(png|svg|jpe?g))$/i.exec(theme.logo) : null;
  if (!m) return null;
  const ext = m[2]!.toLowerCase();
  return { url: `/theme/assets/${m[1]}`, type: ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg" };
}

/** Web app manifest (P-10): the venue's name and logo, Lock-In's icons as the fallback. */
export function manifest(theme: ThemeFile | null): Record<string, unknown> {
  const name = theme?.name?.trim() || DEFAULT_NAME;
  const bg = theme?.colours.background ?? DEFAULT_BG;
  const icons: Record<string, string>[] = [];
  const logo = logoUrl(theme);
  if (logo) icons.push({ src: logo.url, sizes: logo.type === "image/svg+xml" ? "any" : "512x512", type: logo.type, purpose: "any" });
  icons.push(
    { src: "/static/phone/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/static/phone/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/static/phone/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  );
  return {
    id: "/",
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
    description: `Pub quiz at ${name}. Join your team from your phone.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: bg,
    theme_color: bg,
    icons,
  };
}

/**
 * The phone page with the venue's name and home-screen icon filled in, so iPhone's
 * "Add to Home Screen" uses them (it reads the page, not only the manifest).
 * The file on disk is a complete page with Lock-In defaults; this only swaps three values.
 */
export function personalise(page: string, theme: ThemeFile | null): string {
  const name = escapeHtml(theme?.name?.trim() || DEFAULT_NAME);
  const logo = logoUrl(theme);
  // Every replacement is a function (SA-18): a string would treat $&, $` and $' in the name as patterns.
  let out = page
    .replace("<title>Lock-In</title>", () => `<title>${name}</title>`)
    .replace('<meta name="apple-mobile-web-app-title" content="Lock-In">', () => `<meta name="apple-mobile-web-app-title" content="${name}">`);
  // iOS cannot use an SVG as a home-screen icon, so only a PNG or JPEG logo replaces Lock-In's.
  if (logo && logo.type !== "image/svg+xml") {
    out = out.replace('<link rel="apple-touch-icon" href="/static/phone/icons/apple-touch-icon.png">', () => `<link rel="apple-touch-icon" href="${escapeHtml(logo.url)}">`);
  }
  const bg = theme?.colours.background;
  if (bg) out = out.replace('<meta name="theme-color" content="#17191b">', () => `<meta name="theme-color" content="${escapeHtml(bg)}">`);
  return out;
}

export function register(app: App): void {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const page = async (req: Request) => {
    const bytes = await app.files.read(PHONE_PAGE);
    if (!bytes) return notFound();
    const body = personalise(new TextDecoder().decode(bytes), app.services.branding.theme());
    // no-store: the page carries the venue name, which the branding screen can change at any time.
    return new Response(req.method === "HEAD" ? null : body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  };

  app.route("GET", "/", page);
  app.route("GET", "/j/:roomCode", page);
  app.route("GET", "/m/:moveCode", page);

  app.route("GET", "/manifest.webmanifest", () =>
    new Response(JSON.stringify(manifest(app.services.branding.theme())), {
      headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" },
    }));

  app.route("GET", "/sw.js", async (req) =>
    (await serveFile(req, app.files, SERVICE_WORKER, { "Service-Worker-Allowed": "/" })) ?? notFound());
}
