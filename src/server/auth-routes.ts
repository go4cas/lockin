// Host auth HTTP routes (TECH-SPEC 9.2, 12.1, 12.2).

import type { App } from "./app.ts";
import { MIN_PASSWORD, SESSION_COOKIE, readCookie, type RateLimiter } from "./auth.ts";
import { errorResponse, json, readJsonBody } from "./http.ts";

const TOO_MANY = "Too many wrong tries. Wait a minute and try again.";

export function registerAuthRoutes(app: App, limiter: RateLimiter): void {
  app.route("GET", "/api/auth/status", (_req, ctx) => {
    const setupNeeded = app.auth.setupNeeded();
    // Since PR 5 every setup needs the setup code (requests through the tunnel all look local).
    return json({ setupNeeded, signedIn: !!ctx.hostSession, setupCodeNeeded: setupNeeded });
  });

  app.route("POST", "/api/auth/setup", async (req, ctx) => {
    if (!app.auth.setupNeeded()) return errorResponse(409, "already_set", "A host password is already set. Sign in instead.");
    if (limiter.blocked(ctx.ip)) return errorResponse(429, "too_many_tries", TOO_MANY);
    const body = await readJsonBody(req);
    if (!body) return errorResponse(400, "bad_request", "That request was not understood.");
    if (!app.auth.checkSetupCode(body.setupCode)) {
      limiter.fail(ctx.ip);
      return errorResponse(403, "bad_setup_code", "That setup code is not right. It is printed in the server log, or run \"lockin setup-code\" on the server.");
    }
    const password = body.password;
    if (typeof password !== "string" || [...password].length < MIN_PASSWORD) {
      return errorResponse(400, "weak_password", `The password must be at least ${MIN_PASSWORD} characters.`);
    }
    if (password.length > 200) return errorResponse(400, "bad_request", "That password is too long.");
    limiter.succeed(ctx.ip);
    await app.auth.setPassword(password);
    ctx.setCookies.push(app.auth.sessionCookie(app.auth.createSession()));
    app.log("Host password set.");
    return json({ ok: true });
  });

  app.route("POST", "/api/auth/login", async (req, ctx) => {
    if (app.auth.setupNeeded()) return errorResponse(409, "setup_needed", "No host password is set yet. Set one up first.");
    if (limiter.blocked(ctx.ip)) return errorResponse(429, "too_many_tries", TOO_MANY);
    const body = await readJsonBody(req);
    if (!body || typeof body.password !== "string" || body.password.length > 200) {
      return errorResponse(400, "bad_request", "That request was not understood.");
    }
    if (!(await app.auth.verifyPassword(body.password))) {
      limiter.fail(ctx.ip);
      return errorResponse(401, "bad_password", "That password is not right.");
    }
    limiter.succeed(ctx.ip);
    ctx.setCookies.push(app.auth.sessionCookie(app.auth.createSession()));
    return json({ ok: true });
  });

  app.route("POST", "/api/auth/logout", (req, ctx) => {
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (token) app.auth.deleteSession(token);
    ctx.setCookies.push(app.auth.clearCookie());
    return json({ ok: true });
  });
}
