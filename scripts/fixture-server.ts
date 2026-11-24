// Fixture server (TECH-SPEC 13.2): serves public/ and a WebSocket that sends
// the view fixture named in the page's ?fixture= query, so UI threads can build
// screens without the engine.
//
//   bun run fixtures [--port 8081]
//   open http://localhost:8081/fixtures   (a list of every fixture, linked to its page)
//
// Time is frozen-then-running: each connection's server clock starts at the
// fixture time (NOW in tests/fixtures/views/_data.ts), so timers and countdowns
// in the fixtures tick down live from where the fixture was written.

import type { ServerWebSocket } from "bun";
import { withSecurityHeaders } from "../src/server/http.ts";
import { HOST_SECTIONS, contentType, diskSource, serveFile, staticPath } from "../src/server/static.ts";
import type { ClientMsg, ServerMsg, View } from "../src/shared/protocol.ts";
import { NOW } from "../tests/fixtures/views/_data.ts";
import { loadFixtures } from "../tests/fixtures/views/index.ts";

interface Data { fixture: string; startedAt: number }

const PAGES: Record<string, { file: string; owner: string }> = {
  display: { file: "public/display/index.html", owner: "B6" },
  team: { file: "public/phone/index.html", owner: "B7" },
  host: { file: "public/host/run/index.html", owner: "B5" },
};

export async function startFixtureServer(port = 8081, log: (m: string) => void = console.log) {
  const fixtures = await loadFixtures();
  const files = diskSource();

  const missing = (what: string, owner: string) =>
    new Response(`<!doctype html><meta charset="utf-8"><title>Not built yet</title><p>${what} is not built yet (build thread ${owner}). <a href="/fixtures">All fixtures</a></p>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });

  const page = async (req: Request, file: string, owner: string) =>
    (await serveFile(req, files, file)) ?? missing(file, owner);

  function indexPage(): Response {
    const link = (name: string) => {
      const role = name.split("/")[0]!;
      const path = role === "display" ? "/display" : role === "team" ? "/" : "/host/run";
      return `<li><a href="${path}?fixture=${encodeURIComponent(name)}">${name}</a></li>`;
    };
    const groups = ["display", "team", "host"].map((role) =>
      `<h2>${role}</h2><ul>${[...fixtures.keys()].filter((n) => n.startsWith(`${role}/`)).map(link).join("")}</ul>`).join("");
    return new Response(`<!doctype html><meta charset="utf-8"><title>Lock-In fixtures</title><h1>Lock-In view fixtures</h1>${groups}`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const server = Bun.serve<Data>({
    port,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/ws") {
        const fixture = url.searchParams.get("fixture") ?? "";
        if (!fixtures.has(fixture)) return new Response(`Unknown fixture "${fixture}". See /fixtures.`, { status: 404 });
        return srv.upgrade(req, { data: { fixture, startedAt: Date.now() } }) ? undefined : new Response("Upgrade failed", { status: 400 });
      }
      let res: Response;
      if (p === "/fixtures") res = indexPage();
      else if (p.startsWith("/static/")) {
        const path = staticPath(p.slice("/static/".length), files);
        res = (path && (await serveFile(req, files, path))) || new Response("Not found", { status: 404 });
      } else if (p === "/theme.css") res = new Response("/* fixture server: default theme only */\n", { headers: { "Content-Type": contentType("x.css") } });
      else if (p === "/display") res = await page(req, PAGES.display!.file, PAGES.display!.owner);
      else if (p === "/" || /^\/[jm]\/[^/]+$/.test(p)) res = await page(req, PAGES.team!.file, PAGES.team!.owner);
      else if (p === "/host") res = await page(req, "public/host/index.html", "B0");
      else if (p === "/host/login" || p === "/host/setup") res = await page(req, `public/host/${p.slice(6)}.html`, "B0");
      else if (/^\/host\/[a-z]+$/.test(p) && p.slice(6) in HOST_SECTIONS) res = await page(req, `public/host/${p.slice(6)}/index.html`, "B3/B4/B5");
      else res = new Response("Not found", { status: 404 });
      return withSecurityHeaders(res);
    },
    websocket: {
      message(ws: ServerWebSocket<Data>, raw) {
        let msg: ClientMsg;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        const send = (m: ServerMsg) => ws.send(JSON.stringify(m));
        const serverNow = () => NOW + (Date.now() - ws.data.startedAt);
        if (msg.t === "hello") {
          const view = fixtures.get(ws.data.fixture) as View;
          const teamId = view.role === "team" && view.self ? view.self.id : null;
          send({ t: "welcome", protocol: 1, role: msg.role, serverNow: serverNow(), teamId });
          send({ t: "state", seq: 1, serverNow: serverNow(), view });
        } else if (msg.t === "ping") {
          send({ t: "pong", c: msg.c, s: serverNow() });
        } else if (msg.t === "cmd") {
          log(`[fixture] ${ws.data.fixture}: ${msg.name} ${JSON.stringify(msg.args)}`);
          send({ t: "ack", id: msg.id, ok: true, result: null });
        }
      },
    },
  });
  return server;
}

if (import.meta.main) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : 8081;
  const server = await startFixtureServer(port);
  console.log(`Fixture server on http://localhost:${server.port}/fixtures`);
}
