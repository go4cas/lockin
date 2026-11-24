// HTTP router, JSON helpers and web hardening (TECH-SPEC sections 9 and 12.4).

export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RequestContext {
  url: URL;
  params: Record<string, string>;
  /** Client IP: CF-Connecting-IP when the peer is loopback (the tunnel, SA-06), else the socket address. */
  ip: string;
  /** Hash of the host session, if the request carries a valid one. */
  hostSession: string | null;
  /** Cookies to set on the response (the router adds them). */
  setCookies: string[];
}

export type Handler = (req: Request, ctx: RequestContext) => Response | Promise<Response>;

export interface RouteOptions {
  /** Needs a host session cookie; answers 401 without one (TECH-SPEC 9). */
  host?: boolean;
}

interface Route { method: Method; parts: string[]; handler: Handler; opts: RouteOptions }

// SA-13: base-uri, form-action, object-src and script-src added. style-src keeps 'unsafe-inline'
// because Arrow sets style attributes and style-src-attr is not in the display baseline (Safari 14).
export const PAGE_CSP = "default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
/** SA-13: sent on every response when the public URL is https. */
export const HSTS = "max-age=31536000";
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";
export const UPLOAD_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** Error body: `{ error: { code, message } }` with a plain-English message. */
export function errorResponse(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

/** Thrown by the body readers when a body is over its limit; the router answers 413 (SA-02). */
export class BodyTooLarge extends Error {
  constructor(readonly maxBytes: number) { super(`Request body is over ${maxBytes} bytes.`); }
}

/** Bun's server-wide body ceiling: the largest upload (a 6 MB theme asset) plus multipart overhead (SA-02). */
export const MAX_REQUEST_BODY = 6 * 1024 * 1024 + 64 * 1024;
/** Body limits by route (SA-02): sign-in and setup are tiny; settings and titles small; a whole quiz up to 2 MB. */
export const AUTH_BODY_MAX = 4 * 1024;
export const SMALL_BODY_MAX = 64 * 1024;

/**
 * Reads the body as bytes, counting them as they arrive, and stops (cancelling the
 * stream) as soon as there are more than `maxBytes`. Content-Length is only used to
 * refuse early; a chunked body has none, and a lying one is caught by the count.
 */
export async function readBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge(maxBytes);
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      throw new BodyTooLarge(maxBytes);
    }
    parts.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/**
 * Reads a JSON object body of at most `maxBytes` bytes. Returns null if it is not a JSON
 * object; throws BodyTooLarge (answered 413 by the router) if it is too big.
 */
export async function readJsonBody(req: Request, maxBytes = SMALL_BODY_MAX): Promise<Record<string, unknown> | null> {
  const bytes = await readBodyBytes(req, maxBytes);
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Reads a multipart form body of at most `maxBytes` bytes (throws BodyTooLarge), or null if it is not a form. */
export async function readFormBody(req: Request, maxBytes: number): Promise<FormData | null> {
  const bytes = await readBodyBytes(req, maxBytes);
  try {
    return await new Response(bytes, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  }
}

/** The 413 answer for a body over its limit. */
export function tooLarge(): Response {
  return errorResponse(413, "too_large", "That request is too big.");
}

export interface SecurityHeaderOptions {
  /** The public URL is https: add Strict-Transport-Security (SA-13). */
  https?: boolean;
  /** An API answer: `Cache-Control: no-store` unless the handler chose its own (SA-13). */
  api?: boolean;
}

/**
 * Adds the headers every response carries (12.4, SA-13). Pages get the page CSP unless a
 * handler set its own; API answers are not stored by browsers or proxies.
 */
export function withSecurityHeaders(res: Response, opts: SecurityHeaderOptions = {}): Response {
  const h = res.headers;
  try {
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "no-referrer");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    h.set("Permissions-Policy", PERMISSIONS_POLICY);
    if (opts.https) h.set("Strict-Transport-Security", HSTS);
    if (opts.api && !h.has("Cache-Control")) h.set("Cache-Control", "no-store");
    if (!h.has("Content-Security-Policy") && (h.get("Content-Type") ?? "").startsWith("text/html")) {
      h.set("Content-Security-Policy", PAGE_CSP);
    }
    return res;
  } catch {
    // Immutable headers (for example a fetched Response): copy it.
    const copy = new Response(res.body, res);
    return withSecurityHeaders(copy, opts);
  }
}

/**
 * Mutating requests and WebSocket upgrades must carry an Origin equal to the
 * public URL's origin (12.4, as changed by PR 5).
 */
export function originAllowed(req: Request, publicOrigin: string): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && origin === publicOrigin;
}

export class Router {
  private routes: Route[] = [];

  /**
   * Registers a route. Patterns are paths with `:name` segments and an optional
   * trailing `*` that matches the rest (available as params["*"]).
   */
  add(method: Method, pattern: string, handler: Handler, opts: RouteOptions = {}): void {
    const parts = pattern.split("/").filter(Boolean);
    const clash = this.routes.find((r) => r.method === method && r.parts.join("/") === parts.join("/"));
    if (clash) throw new Error(`Route ${method} ${pattern} is registered twice.`);
    this.routes.push({ method, parts, handler, opts });
  }

  /** Finds a route. Literal segments win over `:params`, which win over `*`. */
  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | "method" | null {
    let segs: string[];
    try {
      segs = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return null;
    }
    let best: { route: Route; params: Record<string, string>; score: number } | null = null;
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchParts(route.parts, segs);
      if (!params) continue;
      pathMatched = true;
      if (route.method !== method && !(method === "HEAD" && route.method === "GET")) continue;
      const score = route.parts.reduce((s, p) => s * 3 + (p === "*" ? 0 : p.startsWith(":") ? 1 : 2), 1);
      if (!best || score > best.score) best = { route, params, score };
    }
    if (best) return { route: best.route, params: best.params };
    return pathMatched ? "method" : null;
  }

  async handle(req: Request, ctx: RequestContext): Promise<Response> {
    const m = this.match(req.method, ctx.url.pathname);
    if (m === null) return errorResponse(404, "not_found", "There is nothing at this address.");
    if (m === "method") return errorResponse(405, "method_not_allowed", "That action is not allowed here.");
    ctx.params = m.params;
    if (m.route.opts.host && !ctx.hostSession) {
      return errorResponse(401, "signed_out", "Please sign in to the host console.");
    }
    try {
      return await m.route.handler(req, ctx);
    } catch (e) {
      if (e instanceof BodyTooLarge) return tooLarge();
      throw e;
    }
  }
}

function matchParts(parts: string[], segs: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p === "*") {
      params["*"] = segs.slice(i).join("/");
      return params;
    }
    const s = segs[i];
    if (s === undefined) return null;
    if (p.startsWith(":")) params[p.slice(1)] = s;
    else if (p !== s) return null;
  }
  return segs.length === parts.length ? params : null;
}
