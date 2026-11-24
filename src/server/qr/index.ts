// Owned by B8 (QR codes): /qr/* and /api/server (TECH-SPEC 9.1, 9.2, 11.3).

import type { App } from "../app.ts";
import { errorResponse, json } from "../http.ts";
import { qrSvg } from "./encode.ts";

/** Move codes: 8 characters from the rejoin alphabet (TECH-SPEC 11.2, 11.3). */
const MOVE_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/** The open night's room code and join key (D1), or null when no night is open. */
export function openRoomCode(app: App): { roomCode: string; joinKey: string } | null {
  const row = app.db.query<{ room_code: string; state: string }, []>("SELECT room_code, state FROM nights WHERE status = 'open' LIMIT 1").get();
  if (!row) return null;
  let joinKey = "";
  try { joinKey = (JSON.parse(row.state) as { joinKey?: unknown }).joinKey as string ?? ""; } catch { joinKey = ""; }
  return { roomCode: row.room_code, joinKey: typeof joinKey === "string" ? joinKey : "" };
}

/** Where phones join: `<publicUrl>/j/<roomCode>-<joinKey>` while a night is open, else the join page `<publicUrl>/`. */
export function joinUrl(app: App): string {
  const open = openRoomCode(app);
  if (!open) return `${app.publicUrl}/`;
  return `${app.publicUrl}/j/${open.roomCode}${open.joinKey ? `-${open.joinKey}` : ""}`;
}

export function displayUrl(app: App): string {
  return `${app.publicUrl}/display`;
}

function svg(text: string, title: string): Response {
  return new Response(qrSvg(text, { title }), {
    headers: {
      "Content-Type": "image/svg+xml",
      // The room code changes per night, so never serve an old code from a cache.
      "Cache-Control": "no-store",
    },
  });
}

export function register(app: App): void {
  // Shown on the console (host session) and on a paired display, which sends its pairing token as
  // ?d=<token> (REVIEW finding 4: it carries the room code, so it is not public).
  app.route("GET", "/qr/join.svg", (_req, ctx) => {
    const pairing = app.services.displayPairing;
    const allowed = !!ctx.hostSession || !pairing || pairing.isPaired(ctx.url.searchParams.get("d"));
    if (!allowed) return errorResponse(404, "not_found", "There is nothing at this address.");
    return svg(joinUrl(app), "QR code to join the quiz");
  });

  app.route("GET", "/qr/display.svg", () => svg(displayUrl(app), "QR code for the display address"), { host: true });

  app.route("GET", "/qr/move/:file", (_req, ctx) => {
    const m = /^(.+)\.svg$/.exec(ctx.params.file ?? "");
    const code = m?.[1]?.toUpperCase();
    if (!code || !MOVE_CODE.test(code)) return errorResponse(404, "not_found", "There is nothing at this address.");
    return svg(`${app.publicUrl}/m/${code}`, "QR code to move a team to this phone");
  }, { host: true });

  app.route("GET", "/api/server", () => json({
    version: app.version,
    dataDir: app.config.dataDir,
    publicUrl: app.publicUrl,
    displayUrl: displayUrl(app),
    joinUrl: joinUrl(app),
  }), { host: true });
}
