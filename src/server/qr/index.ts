// Owned by B8 (QR codes): /qr/* and /api/server (TECH-SPEC 9.1, 9.2, 11.3).

import type { App } from "../app.ts";
import { errorResponse, json } from "../http.ts";
import { qrSvg } from "./encode.ts";

/** Move codes: 8 characters from the rejoin alphabet (TECH-SPEC 11.2, 11.3). */
const MOVE_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/** The open night's room code, or null when no night is open. */
export function openRoomCode(app: App): string | null {
  const row = app.db.query<{ room_code: string }, []>("SELECT room_code FROM nights WHERE status = 'open' LIMIT 1").get();
  return row?.room_code ?? null;
}

/** Where phones join: `<publicUrl>/j/<roomCode>` while a night is open, else the join page `<publicUrl>/`. */
export function joinUrl(app: App): string {
  const code = openRoomCode(app);
  return code ? `${app.publicUrl}/j/${code}` : `${app.publicUrl}/`;
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
  // Shown on the display and the console, so it is public.
  app.route("GET", "/qr/join.svg", () => svg(joinUrl(app), "QR code to join the quiz"));

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
