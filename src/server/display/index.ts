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
import type { HostView } from "../../shared/protocol.ts";
import type { CommandResult } from "../ws.ts";
import { fail, safely } from "../ws.ts";
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

/** Paired displays, how many are connected now, unpaired ones showing a code, and each paired display (HostView.displays). */
export function displaysSummary(app: App): NonNullable<HostView["displays"]> {
  const p = app.services.displayPairing;
  const conns = app.ws.connections("display");
  const list = (p?.list() ?? []).map((d) => {
    const open = p!.connectionsOf(d.id).map((id) => app.ws.connection(id)).filter((c): c is NonNullable<typeof c> => !!c);
    return { ...d, connected: open.length > 0, ip: open[0]?.ip ?? null };
  });
  return {
    paired: p?.pairedCount ?? 0,
    connected: conns.filter((c) => c.paired).length,
    waiting: conns.filter((c) => !c.paired).length,
    list,
    bySession: conns.filter((c) => c.pairedBySession).length,
  };
}

/** Host-only updates for display counts, at most one every HOST_UPDATE_MS (SA-03, SA-04). */
const hostsOnly = (app: App) => app.ws.broadcastHosts();

export const DISPLAY_COMMANDS = ["display.pair", "display.unpair", "display.unpairAll"] as const;
export type DisplayCommand = (typeof DISPLAY_COMMANDS)[number];

/** `display.pair { code }`, `display.unpair { id }` and `display.unpairAll` (host only; the hub has checked the role). */
export function displayCommand(app: App, name: DisplayCommand, args: Record<string, unknown>): CommandResult {
  const pairing = app.services.displayPairing;
  if (!pairing) return fail("wrong_phase");
  if (name === "display.unpairAll") {
    const n = pairing.unpairAll();
    for (const c of app.ws.connections("display")) {
      pairing.disconnect(c.id);
      c.setPaired(false);
      app.ws.sendState(c);
    }
    hostsOnly(app);
    return { ok: true, result: { unpaired: n } };
  }
  if (name === "display.unpair") {
    // SA-11: one display at a time, by the id in HostView.displays.list.
    const id = args.id;
    if (typeof id !== "string" || !/^[0-9a-f]{8}$/.test(id)) return fail("bad_args");
    const conns = pairing.connectionsOf(id);
    if (!pairing.unpair(id)) return fail("not_found", "That display is not paired any more.");
    for (const connId of conns) {
      pairing.disconnect(connId);
      const c = app.ws.connection(connId);
      if (!c) continue;
      c.setPaired(false);
      app.ws.sendState(c);
    }
    hostsOnly(app);
    return { ok: true, result: { paired: pairing.pairedCount } };
  }
  const claim = pairing.claim(args.code);
  if ("error" in claim) {
    return fail(claim.error, claim.error === "too_many_tries" ? "Too many wrong codes. Wait a minute and try again." : "No display is showing that code. Check the number on the TV.");
  }
  const conn = app.ws.connection(claim.connId);
  if (!conn || conn.role !== "display") {
    pairing.forget(claim.connId);
    return fail("bad_code", "That display is no longer connected. Reload it and try its new code.");
  }
  // SA-03: tell the host which screen this was, so a stolen pairing is noticed.
  const connectedFor = Math.max(0, app.clock.now() - conn.connectedAt);
  const { token, id } = pairing.issue();   // throws on a failed write; the code then stays valid (LI-014)
  pairing.forget(conn.id);
  pairing.connect(conn.id, token);
  conn.setPaired(true, token);
  app.ws.sendState(conn);
  hostsOnly(app);
  return { ok: true, result: { paired: pairing.pairedCount, ip: conn.ip, connectedFor, id } };
}

/** Sends each unpaired display whose code expired its new code (D2, SA-03 step 3). */
export function sweepPairing(app: App): void {
  const pairing = app.services.displayPairing;
  if (!pairing) return;
  pairing.markConnectedSeen();
  pairing.dropUnused();   // SA-11: 90 days unused
  for (const id of pairing.expired()) {
    const conn = app.ws.connection(id);
    if (conn && !conn.paired) app.ws.sendState(conn);   // the view provider makes the new code
    else pairing.forget(id);
  }
}

/** A waiting place came free: an unpaired display that was turned away (no code) may now get one. */
function offerFreedCodes(app: App): void {
  const pairing = app.services.displayPairing;
  if (!pairing) return;
  for (const c of app.ws.connections("display")) {
    if (c.paired || pairing.holds(c.id)) continue;
    app.ws.sendState(c);
    if (pairing.holds(c.id)) return;   // one place, one display
  }
}

export function register(app: App): void {
  const pairing = new DisplayPairing(app.config.dataDir, app.clock, (m) => app.log(m));
  app.services.displayPairing = pairing;
  app.ws.setDisplayAuthoriser((conn, token) => {
    if (pairing.connect(conn.id, token)) conn.setPaired(true);
    // D5: opened from a browser signed in to the console ("Open display"): paired for as long
    // as that session lives, with no stored token. Signing out (or expiry) unpairs it.
    else if (app.ws.hostSessionAlive(conn)) conn.pairBySession();
  });
  app.ws.onConnect((conn) => { if (conn.role === "display") hostsOnly(app); });
  app.ws.onDisconnect((conn) => {
    if (conn.role !== "display") return;
    const held = pairing.holds(conn.id);
    pairing.forget(conn.id);
    pairing.disconnect(conn.id);
    hostsOnly(app);
    if (held) offerFreedCodes(app);
  });

  // D2: codes expire after PAIR_CODE_TTL_MS; the display is sent its new code at once.
  let sweep: ReturnType<typeof setInterval> | null = null;
  app.onStart(() => { sweep = setInterval(() => safely(app.log, "Pairing code sweep", () => sweepPairing(app)), 15_000); });
  app.onStop(() => { if (sweep) clearInterval(sweep); });

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
