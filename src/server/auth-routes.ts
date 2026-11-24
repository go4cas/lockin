// Host auth HTTP routes (TECH-SPEC 9.2, 12.1, 12.2).

import type { App } from "./app.ts";
import { Busy, MIN_PASSWORD, type RateLimiter } from "./auth.ts";
import { AUTH_BODY_MAX, errorResponse, json, readJsonBody } from "./http.ts";

/** SA-08: blocks grow (1, 2, 4, 8, then 15 minutes), so say how long. SA-17: logged. */
function tooMany(app: App, limiter: RateLimiter, ip: string): Response {
  app.security.event("limiter_tripped", ip, "sign-in");
  const mins = Math.max(1, Math.ceil(limiter.blockedFor(ip) / 60_000));
  const wait = mins === 1 ? "a minute" : `${mins} minutes`;
  return errorResponse(429, "too_many_tries", `Too many wrong tries. Wait ${wait} and try again.`);
}

/** SA-08: every password check slot and queue place is taken. Not counted as a wrong try. */
function busy(app: App, ip: string): Response {
  app.security.event("limiter_tripped", ip, "password checks busy");
  return errorResponse(429, "busy", "Lock-In is busy. Try again in a moment.");
}

export function registerAuthRoutes(app: App, limiter: RateLimiter): void {
  app.route("GET", "/api/auth/status", (_req, ctx) => {
    const setupNeeded = app.auth.setupNeeded();
    // Since PR 5 every setup needs the setup code (requests through the tunnel all look local).
    return json({ setupNeeded, signedIn: !!ctx.hostSession, setupCodeNeeded: setupNeeded });
  });

  app.route("POST", "/api/auth/setup", async (req, ctx) => {
    if (!app.auth.setupNeeded()) return errorResponse(409, "already_set", "A host password is already set. Sign in instead.");
    if (limiter.blocked(ctx.ip)) return tooMany(app, limiter, ctx.ip);
    const body = await readJsonBody(req, AUTH_BODY_MAX);
    if (!body) return errorResponse(400, "bad_request", "That request was not understood.");
    if (!app.auth.checkSetupCode(body.setupCode)) {
      limiter.fail(ctx.ip);
      app.security.event("setup_code_wrong", ctx.ip);
      return errorResponse(403, "bad_setup_code", "That setup code is not right. It is printed in the server log, or run \"lockin setup-code\" on the server.");
    }
    const password = body.password;
    if (typeof password !== "string" || [...password].length < MIN_PASSWORD) {
      return errorResponse(400, "weak_password", `The password must be at least ${MIN_PASSWORD} characters. A passphrase of a few words is easiest to remember.`);
    }
    if (password.length > 200) return errorResponse(400, "bad_request", "That password is too long.");
    try {
      await app.auth.setPassword(password);
    } catch (e) {
      if (e instanceof Busy) return busy(app, ctx.ip);
      throw e;
    }
    limiter.succeed(ctx.ip);
    ctx.setCookies.push(app.auth.sessionCookie(app.auth.createSession()));
    app.log("Host password set.");
    app.security.event("password_set", ctx.ip);
    return json({ ok: true });
  });

  app.route("POST", "/api/auth/login", async (req, ctx) => {
    if (app.auth.setupNeeded()) return errorResponse(409, "setup_needed", "No host password is set yet. Set one up first.");
    if (limiter.blocked(ctx.ip)) return tooMany(app, limiter, ctx.ip);
    const body = await readJsonBody(req, AUTH_BODY_MAX);
    if (!body || typeof body.password !== "string" || body.password.length > 200) {
      return errorResponse(400, "bad_request", "That request was not understood.");
    }
    let right: boolean;
    try {
      right = await app.auth.verifyPassword(body.password);
    } catch (e) {
      if (e instanceof Busy) return busy(app, ctx.ip);
      throw e;
    }
    if (!right) {
      limiter.fail(ctx.ip);
      app.security.event("sign_in_failed", ctx.ip);
      return errorResponse(401, "bad_password", "That password is not right.");
    }
    limiter.succeed(ctx.ip);
    ctx.setCookies.push(app.auth.sessionCookie(app.auth.createSession()));
    app.security.event("signed_in", ctx.ip);
    return json({ ok: true });
  });

  app.route("POST", "/api/auth/logout", (req, ctx) => {
    const { token } = app.auth.readSessionCookie(req.headers.get("cookie"));
    if (token) app.auth.deleteSession(token);
    ctx.setCookies.push(app.auth.clearCookie());
    if (app.auth.secureCookie) ctx.setCookies.push(app.auth.clearCookie(true));   // the pre-SA-13 name too
    if (token) app.security.event("signed_out", ctx.ip);
    return json({ ok: true });
  });
}
