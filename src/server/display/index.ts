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
import type { CommandResult } from "../ws.ts";
import { fail } from "../ws.ts";
import { DisplayPairing } from "./pairing.ts";

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

/** Paired displays, how many are connected now, and unpaired ones showing a code (HostView.displays). */
export function displaysSummary(app: App): { paired: number; connected: number; waiting: number } {
  const p = app.services.displayPairing;
  const conns = app.ws.connections("display");
  return { paired: p?.pairedCount ?? 0, connected: conns.filter((c) => c.paired).length, waiting: conns.filter((c) => !c.paired).length };
}

const hostsOnly = (app: App) => app.ws.broadcastState((c) => c.role === "host");

/** `display.pair { code }` and `display.unpairAll` (host only; the hub has checked the role). */
export function displayCommand(app: App, name: "display.pair" | "display.unpairAll", args: Record<string, unknown>): CommandResult {
  const pairing = app.services.displayPairing;
  if (!pairing) return fail("wrong_phase");
  if (name === "display.unpairAll") {
    const n = pairing.unpairAll();
    for (const c of app.ws.connections("display")) {
      c.setPaired(false);
      app.ws.sendState(c);
    }
    hostsOnly(app);
    return { ok: true, result: { unpaired: n } };
  }
  const claim = pairing.claim(args.code);
  if ("error" in claim) {
    return fail(claim.error, claim.error === "too_many_tries" ? "Too many wrong codes. Wait a minute and try again." : "No display is showing that code. Check the number on the TV.");
  }
  const conn = app.ws.connection(claim.connId);
  if (!conn || conn.role !== "display") return fail("bad_code", "That display is no longer connected. Reload it and try its new code.");
  conn.setPaired(true, pairing.issue());
  app.ws.sendState(conn);
  hostsOnly(app);
  return { ok: true, result: { paired: pairing.pairedCount } };
}

export function register(app: App): void {
  const pairing = new DisplayPairing(app.config.dataDir, app.clock);
  app.services.displayPairing = pairing;
  app.ws.setDisplayAuthoriser((conn, token) => {
    if (pairing.isPaired(token)) conn.setPaired(true);
    // Opened from a browser signed in to the console ("Open display"): paired at once.
    else if (app.ws.hostSessionAlive(conn)) conn.setPaired(true, pairing.issue());
  });
  app.ws.onConnect((conn) => { if (conn.role === "display") hostsOnly(app); });
  app.ws.onDisconnect((conn) => {
    if (conn.role !== "display") return;
    pairing.forget(conn.id);
    hostsOnly(app);
  });

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
