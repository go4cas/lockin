// Owned by B6 (display). GET /display serves the display page, no sign-in (T-01, TECH-SPEC 9.1).
// Its scripts and styles load from /static/display/, /static/shared/ and /vendor/arrow/.
//
// DisplayView carries no venue logo or tagline, so the page gets them here instead: the
// server fills two <meta> tags from the theme (B4's store) and the copy pools. The page
// reloads itself when venue.themeVersion changes, so a new logo shows (see NOTES).

import type { App } from "../app.ts";
import { branding } from "../branding/index.ts";
import { assetUrl } from "../branding/derive.ts";
import type { ThemeFile } from "../../shared/formats.ts";

export const DISPLAY_PAGE = "public/display/index.html";
export const DEFAULT_TAGLINE = "Lock in your answers.";

const LOGO_META = '<meta name="lockin-logo" content="">';
const TAGLINE_META = `<meta name="lockin-tagline" content="${DEFAULT_TAGLINE}">`;

/** Escapes text for an HTML attribute. */
function attr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The venue logo's URL, if the theme names an image in its assets folder. */
export function logoUrl(theme: ThemeFile | null): string | null {
  return theme?.logo && /^assets\/[A-Za-z0-9._-]+\.(png|svg|jpe?g)$/i.test(theme.logo) ? assetUrl(theme.logo) : null;
}

/** The display page with the venue logo and a tagline filled in. */
export function personalise(page: string, logo: string | null, tagline: string | null): string {
  let out = page;
  if (logo) out = out.replace(LOGO_META, `<meta name="lockin-logo" content="${attr(logo)}">`);
  if (tagline) out = out.replace(TAGLINE_META, `<meta name="lockin-tagline" content="${attr(tagline)}">`);
  return out;
}

export function register(app: App): void {
  app.route("GET", "/display", async (req) => {
    const bytes = await app.files.read(DISPLAY_PAGE);
    if (!bytes) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    let theme: ThemeFile | null = null;
    try { theme = branding(app).theme(); } catch { theme = null; }
    const picked = app.services.copyPicker?.pick("taglines", { pub: theme?.name ?? undefined }, {}) ?? null;
    const body = personalise(new TextDecoder().decode(bytes), logoUrl(theme), picked?.text ?? null);
    // no-store: the logo and tagline come from the theme, which can change at any time.
    return new Response(req.method === "HEAD" ? null : body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  });
}
