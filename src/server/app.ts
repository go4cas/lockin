// The App: what every server module's register(app) receives (TECH-SPEC 3.2).
// createApp() is the composition root: it builds config, database, auth, HTTP,
// WebSocket and every shared service (services.ts, code review LI-020), then calls
// each module's register(). startServer() listens.

import type { Database } from "bun:sqlite";
import { isIP } from "node:net";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { Auth, RateLimiter, type Clock, type PasswordHasher } from "./auth.ts";
import { registerAuthRoutes } from "./auth-routes.ts";
import { ensureDataDir, isLocalDevUrl, type Config } from "./config.ts";
import { openDb } from "./db.ts";
import { MAX_REQUEST_BODY, Router, errorResponse, json, originAllowed, withSecurityHeaders, type Handler, type Method, type RequestContext, type RouteOptions } from "./http.ts";
import { diskSource, registerStatic, type FileSource } from "./static.ts";
import { Hub, safely, type BunServer, type SocketData } from "./ws.ts";
import { SecurityLog } from "./seclog.ts";
import { register as registerBranding } from "./branding/index.ts";
import { register as registerDisplay } from "./display/index.ts";
import { register as registerNight } from "./night/index.ts";
import { register as registerPhone } from "./phone/index.ts";
import { register as registerQr } from "./qr/index.ts";
import { register as registerQuizzes } from "./quizzes/index.ts";
import { createServices, type ServiceOverrides, type Services } from "./services.ts";

export type { Services } from "./services.ts";

export const VERSION: string = pkg.version;

export interface App {
  readonly version: string;
  readonly config: Config;
  readonly db: Database;
  readonly clock: Clock;
  readonly auth: Auth;
  readonly ws: Hub;
  readonly files: FileSource;
  readonly services: Services;
  /** Registers an HTTP route; `{ host: true }` needs a host session (401 without). */
  route(method: Method, pattern: string, handler: Handler, opts?: RouteOptions): void;
  /** Runs once the server is listening (after every module registered). */
  onStart(fn: () => void | Promise<void>): void;
  /** Runs when the server stops. */
  onStop(fn: () => void | Promise<void>): void;
  log(message: string): void;
  /** Security events (SA-17): one line each with the client IP, never a secret, rate-limited. */
  readonly security: SecurityLog;
  /** The full join/display base address, e.g. "https://quiz.example.com". */
  readonly publicUrl: string;
}

export interface AppOptions {
  clock?: Clock;
  files?: FileSource;
  log?: (message: string) => void;
  /** Password hashing (tests inject a fake to count what runs at once, SA-08). */
  hasher?: PasswordHasher;
  /** Test doubles for the rules and the copy picker (LI-020: explicit, never swapped after start). */
  services?: ServiceOverrides;
}

interface InternalApp extends App {
  router: Router;
  limiter: RateLimiter;
  startHooks: (() => void | Promise<void>)[];
  stopHooks: (() => void | Promise<void>)[];
}

const systemClock: Clock = { now: () => Date.now() };

export function createApp(config: Config, opts: AppOptions = {}): InternalApp {
  ensureDataDir(config.dataDir);
  const clock = opts.clock ?? systemClock;
  const db = openDb(join(config.dataDir, "lockin.db"));
  const auth = new Auth(db, config.dataDir, clock, !isLocalDevUrl(config.publicUrl), opts.hasher);
  const log = opts.log ?? ((m: string) => console.log(`${new Date().toISOString()} ${m}`));
  const security = new SecurityLog(clock, log);
  const hub = new Hub({ clock, sessionAlive: (h) => auth.sessionAlive(h), touchSession: (h) => auth.touchSession(h), log, security });
  auth.onSessionsDeleted = (hashes) => hub.signOut(hashes);
  const router = new Router();
  const files = opts.files ?? diskSource();
  const { services, ready } = createServices({ dataDir: config.dataDir, db, clock, files, log }, opts.services);

  const app: InternalApp = {
    version: VERSION,
    config,
    db,
    clock,
    auth,
    ws: hub,
    files,
    services,
    publicUrl: config.publicUrl,
    router,
    limiter: new RateLimiter(clock),
    startHooks: [],
    stopHooks: [],
    route: (method, pattern, handler, routeOpts) => router.add(method, pattern, handler, routeOpts),
    onStart: (fn) => { app.startHooks.push(fn); },
    onStop: (fn) => { app.stopHooks.push(fn); },
    log,
    security,
  };

  // Core routes (B0)
  app.route("GET", "/api/ping", () => json({ app: "lockin", version: VERSION }));
  registerAuthRoutes(app, app.limiter);
  registerStatic(app);

  // Start-up (4.4): read the copy pools and both branding files now, so problems show in the log at start.
  app.onStart(async () => {
    await ready;
    services.branding.theme();
    services.branding.venue();
  });

  // Every module registers its own routes and hooks; the services above are already built.
  registerQuizzes(app);
  registerBranding(app);
  registerNight(app);
  registerQr(app);
  registerDisplay(app);
  registerPhone(app);

  hub.assertWired();   // LI-020: a missing plug-in fails here, not as a fail-open default later
  return app;
}

/** True for a loopback peer: 127.0.0.0/8, ::1 and IPv4-mapped 127.x (SA-06). */
export function isLoopback(address: string): boolean {
  const a = address.toLowerCase();
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  return isIP(v4) === 4 && v4.startsWith("127.");
}

/**
 * The client's IP (TECH-SPEC 4.5, SA-06). CF-Connecting-IP is believed only when the peer is
 * loopback (cloudflared on the same machine) and the value is an IP address; otherwise anyone
 * who can reach the port could pick their own address and dodge every per-IP limit.
 */
export function clientIp(header: string | null, peer: string | null | undefined): string {
  const value = header?.trim() ?? "";
  if (peer && isLoopback(peer) && value && isIP(value) !== 0) return value;
  return peer || "unknown";
}

/** True when the server listens on more than loopback (SA-06 start warning). */
export function bindIsOpen(bind: string): boolean {
  return !(bind === "localhost" || isLoopback(bind));
}

/** How often ended host sessions are swept (SA-12). */
export const SESSION_SWEEP_MS = 60_000;

/** SA-12: signs out sockets whose session ended by expiry, and deletes ended sessions. */
export function sweepSessions(app: App): { closed: number; deleted: number } {
  const closed = app.ws.sweepSessions();
  const deleted = app.auth.pruneSessions();
  app.security.flush();   // SA-17: counts of held-back lines whose 10 s has passed
  return { closed, deleted };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Handles one HTTP request (also used by tests without a socket). */
export async function handleRequest(app: InternalApp, req: Request, server: BunServer): Promise<Response | undefined> {
  const url = new URL(req.url);
  const ip = clientIp(req.headers.get("cf-connecting-ip"), server.requestIP(req)?.address);
  const { token: cookie, legacy } = app.auth.readSessionCookie(req.headers.get("cookie"));
  const session = app.auth.checkSession(cookie);
  const https = app.publicUrl.startsWith("https:");
  const api = url.pathname.startsWith("/api/");
  const secured = (r: Response) => withSecurityHeaders(r, { https, api });

  if (url.pathname === "/ws") {
    if (!originAllowed(req, app.publicUrl)) {
      app.security.event("connection_refused", ip, "wrong origin");
      return secured(errorResponse(403, "forbidden_origin", "This page is not allowed to connect."));
    }
    // SA-04: caps on open sockets, in total and per client IP, checked before any socket is made.
    const data = app.ws.admit(ip, session?.hash ?? null);
    if (!data) {
      app.security.event("connection_refused", ip, "too many sockets");
      return secured(errorResponse(429, "too_many_connections", "Too many screens are connected from here. Try again in a minute."));
    }
    const ok = server.upgrade(req, { data });
    if (!ok) app.ws.release(data);
    return ok ? undefined : secured(errorResponse(400, "bad_upgrade", "This address only takes WebSocket connections."));
  }

  if (MUTATING.has(req.method) && !originAllowed(req, app.publicUrl)) {
    app.security.event("connection_refused", ip, "request from another site");
    return secured(errorResponse(403, "forbidden_origin", "This request came from another site, so it was refused."));
  }

  const ctx: RequestContext = { url, params: {}, ip, hostSession: session?.hash ?? null, setCookies: [] };
  // SA-13: a session under the old cookie name is moved to the __Host- name.
  if (session && cookie && (session.renewCookie || legacy)) ctx.setCookies.push(app.auth.sessionCookie(cookie));
  if (session && legacy) ctx.setCookies.push(app.auth.clearCookie(true));
  let res: Response;
  try {
    res = await app.router.handle(req, ctx);
  } catch (e) {
    app.log(`${req.method} ${url.pathname} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    res = errorResponse(500, "server_error", "Something went wrong on the server. Try again.");
  }
  res = secured(res);
  for (const c of ctx.setCookies) res.headers.append("Set-Cookie", c);
  return res;
}

export interface RunningServer {
  app: App;
  server: BunServer;
  url: string;
  port: number;
  stop(): Promise<void>;
}

/** Starts listening (TECH-SPEC 4.4). Logs the public URL and, if no password is set, the setup code. */
export async function startServer(config: Config, opts: AppOptions = {}): Promise<RunningServer> {
  const app = createApp(config, opts);
  const setupCode = app.auth.ensureSetupCode();

  const server: BunServer = Bun.serve<SocketData>({
    hostname: config.bind,
    port: config.port,
    // SA-02: Bun's default is 128 MB; nothing Lock-In takes is bigger than a 6 MB upload.
    maxRequestBodySize: MAX_REQUEST_BODY,
    // SA-13: the default follows NODE_ENV, which the binary does not set; development mode is for Bun's error pages.
    development: false,
    fetch: (req, srv) => handleRequest(app, req, srv),
    websocket: app.ws.websocket,
    error: (e) => {
      app.log(`Request failed: ${e.stack ?? e.message}`);
      return withSecurityHeaders(errorResponse(500, "server_error", "Something went wrong on the server. Try again."), { https: config.publicUrl.startsWith("https:") });
    },
  });

  for (const fn of app.startHooks) await fn();

  // SA-12: once a minute, end sockets whose session has ended and delete ended sessions.
  const sessionSweep = setInterval(() => safely(app.log, "Session sweep", () => sweepSessions(app)), SESSION_SWEEP_MS);

  const port = server.port!;
  app.log(`Lock-In ${VERSION} on Bun ${Bun.version}`);
  app.log(`Public address: ${config.publicUrl}  (host console: ${config.publicUrl}/host)`);
  app.log(`Data folder: ${config.dataDir}`);
  if (bindIsOpen(config.bind) && config.publicUrl.startsWith("https:")) {
    app.log("This port is open to the network. Lock-In expects to sit behind the tunnel on 127.0.0.1.");
  }
  if (setupCode) app.log(`No host password is set yet. Setup code: ${setupCode}`);
  app.log(`Listening on ${config.bind}:${port}`);   // last, so "ready" means every line above is out

  let stopped = false;
  return {
    app,
    server,
    port,
    url: `http://${config.bind.includes(":") ? `[${config.bind}]` : config.bind}:${port}`,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(sessionSweep);
      for (const fn of app.stopHooks) await fn();
      app.ws.closeAll();
      await server.stop(true);
      app.db.close();
    },
  };
}
