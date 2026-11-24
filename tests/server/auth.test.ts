import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../src/server/main.ts";
import { CODE_ALPHABET, RateLimiter, readCookie, sha256 } from "../../src/server/auth.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { TEST_PASSWORD, cookieFrom, startTestServer, type TestServer } from "../helpers/server.ts";

const servers: TestServer[] = [];
async function server(opts: Parameters<typeof startTestServer>[0] = {}) {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
}
afterEach(async () => { for (const s of servers.splice(0)) await s.stop(); });

const post = (s: TestServer, path: string, body: unknown, extra: { cookie?: string; headers?: Record<string, string> } = {}) =>
  s.fetch(path, { method: "POST", body: JSON.stringify(body), cookie: extra.cookie, headers: extra.headers });

describe("first run and the setup code (TECH-SPEC 12.1)", () => {
  test("a setup code is made at start, logged, and kept in the data folder", async () => {
    const s = await server();
    const code = s.app.auth.setupCode()!;
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    expect(s.logs.some((l) => l.includes(`Setup code: ${code}`))).toBe(true);
    expect(readFileSync(join(s.dataDir, "setup-code"), "utf8").trim()).toBe(code);
  });

  test("status says setup is needed and the code is always needed", async () => {
    const s = await server();
    expect(await (await s.fetch("/api/auth/status")).json()).toEqual({ setupNeeded: true, signedIn: false, setupCodeNeeded: true });
  });

  test("setup without the code is refused, even from the machine itself", async () => {
    const s = await server();
    let res = await post(s, "/api/auth/setup", { password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("bad_setup_code");
    res = await post(s, "/api/auth/setup", { password: TEST_PASSWORD, setupCode: "BBBBBBBB" });
    expect(res.status).toBe(403);
    expect(s.app.auth.setupNeeded()).toBe(true);
  });

  test("setup with the code (any case) sets the password, signs in and removes the code", async () => {
    const s = await server();
    const code = s.app.auth.setupCode()!;
    const res = await post(s, "/api/auth/setup", { password: TEST_PASSWORD, setupCode: code.toLowerCase() });
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toStartWith("lockin_host=");
    expect(s.app.auth.setupNeeded()).toBe(false);
    expect(existsSync(join(s.dataDir, "setup-code"))).toBe(false);
    expect(await (await s.fetch("/api/auth/status", { cookie })).json()).toEqual({ setupNeeded: false, signedIn: true, setupCodeNeeded: false });
    // A second setup is refused.
    expect((await post(s, "/api/auth/setup", { password: TEST_PASSWORD, setupCode: code })).status).toBe(409);
  });

  test("passwords shorter than 8 characters are refused", async () => {
    const s = await server();
    const res = await post(s, "/api/auth/setup", { password: "short", setupCode: s.app.auth.setupCode() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("The password must be at least 8 characters. A passphrase of a few words is easiest to remember.");
  });

  test("the password is stored only as an argon2id hash, outside the database", async () => {
    const s = await server();
    await s.signIn();
    const file = readFileSync(join(s.dataDir, "auth.json"), "utf8");
    expect(file).not.toContain(TEST_PASSWORD);
    expect(JSON.parse(file).passwordHash).toStartWith("$argon2id$");
  });
});

describe("login, sessions and logout (TECH-SPEC 12.2)", () => {
  test("login sets a session cookie with the right flags; only its hash is stored", async () => {
    const s = await server();
    await s.signIn();
    const res = await post(s, "/api/auth/login", { password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const header = res.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=604800");
    expect(header).not.toContain("Secure");      // http://localhost development URL
    const token = readCookie(header, "lockin_host")!;
    const rows = s.app.db.query<{ token_hash: string }, []>("SELECT token_hash FROM host_sessions").all().map((r) => r.token_hash);
    expect(rows).toContain(sha256(token));
    expect(rows).not.toContain(token);
  });

  test("the cookie is Secure for an https public URL", async () => {
    const s = await server({ config: { publicUrl: "https://quiz.example.com" } });
    const res = await s.fetch("/api/auth/setup", {
      method: "POST", origin: "https://quiz.example.com",
      body: JSON.stringify({ password: TEST_PASSWORD, setupCode: s.app.auth.setupCode() }),
    });
    expect(res.headers.get("set-cookie")).toContain("; Secure");
  });

  test("a wrong password is refused", async () => {
    const s = await server();
    await s.signIn();
    const res = await post(s, "/api/auth/login", { password: "wrong password" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("bad_password");
  });

  test("login is rate limited: 5 failures a minute, then a 1-minute wait", async () => {
    const clock = new FakeClock();
    const s = await server({ clock });
    await s.signIn();
    const ip = { headers: { "CF-Connecting-IP": "203.0.113.9" } };
    for (let i = 0; i < 5; i++) expect((await post(s, "/api/auth/login", { password: "nope nope" }, ip)).status).toBe(401);
    let res = await post(s, "/api/auth/login", { password: TEST_PASSWORD }, ip);
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("Too many wrong tries. Wait a minute and try again.");
    // Another address is not affected.
    expect((await post(s, "/api/auth/login", { password: TEST_PASSWORD }, { headers: { "CF-Connecting-IP": "203.0.113.10" } })).status).toBe(200);
    clock.advance(61_000);
    res = await post(s, "/api/auth/login", { password: TEST_PASSWORD }, ip);
    expect(res.status).toBe(200);
  });

  test("RateLimiter forgets failures older than the window", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(clock);
    for (let i = 0; i < 4; i++) rl.fail("a");
    clock.advance(61_000);
    rl.fail("a");
    expect(rl.blocked("a")).toBe(false);
  });

  test("host routes need a session; logout ends it", async () => {
    const s = await server();
    const cookie = await s.signIn();
    s.app.route("GET", "/api/test-host-only", () => Response.json({ ok: true }), { host: true });
    expect((await s.fetch("/api/test-host-only")).status).toBe(401);
    expect((await s.fetch("/api/test-host-only", { cookie })).status).toBe(200);
    const out = await post(s, "/api/auth/logout", {}, { cookie });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await s.fetch("/api/test-host-only", { cookie })).status).toBe(401);
  });

  test("sessions last 7 days and are renewed on use", async () => {
    const clock = new FakeClock();
    const s = await server({ clock });
    const cookie = await s.signIn();
    const status = async () => (await (await s.fetch("/api/auth/status", { cookie })).json()).signedIn;
    clock.advance(6 * 24 * 3600_000);
    const res = await s.fetch("/api/auth/status", { cookie });
    expect((await res.json()).signedIn).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=604800");   // renewed
    clock.advance(6 * 24 * 3600_000);                                    // 12 days after login, 6 after last use
    expect(await status()).toBe(true);
    clock.advance(8 * 24 * 3600_000);                                    // unused for 8 days
    expect(await status()).toBe(false);
  });

  test("a garbage or unknown cookie is not a session", async () => {
    const s = await server();
    await s.signIn();
    expect((await (await s.fetch("/api/auth/status", { cookie: "lockin_host=abc" })).json()).signedIn).toBe(false);
  });
});

describe("lockin reset-password and lockin setup-code (TECH-SPEC 4.1)", () => {
  async function run(args: string[]) {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try {
      const code = await main(args, {}, process.cwd());
      return { code, out: lines.join("\n") };
    } finally {
      console.log = orig;
    }
  }

  test("setup-code prints the code the running server checks", async () => {
    const s = await server();
    const { code, out } = await run(["setup-code", "--data", s.dataDir]);
    expect(code).toBe(0);
    expect(out.trim()).toBe(s.app.auth.setupCode()!);
  });

  test("setup-code says so when a password is set", async () => {
    const s = await server();
    await s.signIn();
    const { out } = await run(["setup-code", "--data", s.dataDir]);
    expect(out).toContain("already set");
  });

  test("reset-password removes the password, signs everyone out and prints a new code", async () => {
    const s = await server();
    const cookie = await s.signIn();
    const { code, out } = await run(["reset-password", "--data", s.dataDir]);
    expect(code).toBe(0);
    const newCode = s.app.auth.setupCode()!;
    expect(out).toContain(newCode);
    expect(s.app.auth.setupNeeded()).toBe(true);
    expect((await (await s.fetch("/api/auth/status", { cookie })).json()).signedIn).toBe(false);
    // The running server accepts the new code at once.
    const res = await post(s, "/api/auth/setup", { password: "a brand new one", setupCode: newCode });
    expect(res.status).toBe(200);
  });
});
