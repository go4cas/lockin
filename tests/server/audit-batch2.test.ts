// Security audit Batch 2 (docs/SECURITY-AUDIT.md): SA-06, SA-08, SA-09, SA-10, SA-12.
// SA-11 and decision D5 are in tests/display/pairing.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindIsOpen, clientIp, isLoopback, sweepSessions } from "../../src/server/app.ts";
import { Busy, HashGate, RateLimiter, SESSION_DAYS, SESSION_MAX_DAYS, type PasswordHasher } from "../../src/server/auth.ts";
import { writeTextAtomic } from "../../src/server/files.ts";
import { crashHandler } from "../../src/server/main.ts";
import { ClockScheduler } from "../../src/server/night/scheduler.ts";
import { TIMER_RETRY_MS } from "../../src/server/night/engine.ts";
import type { ServerMsg } from "../../src/shared/protocol.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { startTestServer, TEST_PASSWORD, TEST_PUBLIC_URL, type TestServer } from "../helpers/server.ts";
import { host, joinTeam, makeQuiz, q, rig, text, writeQuiz, type Rig } from "../night/fakes.ts";

const DAY = 24 * 60 * 60_000;
const servers: TestServer[] = [];
const clients: TestClient[] = [];
const rigs: Rig[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (clients.length) clients.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
  while (rigs.length) rigs.pop()!.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function server(opts: Parameters<typeof startTestServer>[0] = {}) {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
}

const login = (s: TestServer, password: string, headers: Record<string, string> = {}, base?: string) =>
  fetch(`${base ?? s.base}/api/auth/login`, { method: "POST", body: JSON.stringify({ password }), headers: { Origin: TEST_PUBLIC_URL, ...headers } });

describe("SA-06: CF-Connecting-IP is believed only from the tunnel on loopback", () => {
  test("clientIp: loopback peer with a header, other peers, malformed headers", () => {
    expect(clientIp("203.0.113.9", "127.0.0.1")).toBe("203.0.113.9");          // cloudflared on this machine
    expect(clientIp("2001:db8::1", "::1")).toBe("2001:db8::1");
    expect(clientIp("203.0.113.9", "::ffff:127.0.0.1")).toBe("203.0.113.9");
    expect(clientIp("203.0.113.9", "192.0.2.50")).toBe("192.0.2.50");            // anyone else: the peer wins
    expect(clientIp("203.0.113.9", "::ffff:192.0.2.50")).toBe("::ffff:192.0.2.50");
    expect(clientIp("not-an-ip", "127.0.0.1")).toBe("127.0.0.1");               // malformed: the peer wins
    expect(clientIp("203.0.113.9, 198.51.100.1", "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp("", "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp(null, "192.0.2.50")).toBe("192.0.2.50");
    expect(clientIp("203.0.113.9", undefined)).toBe("unknown");
  });

  test("isLoopback and bindIsOpen", () => {
    for (const a of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"]) expect(isLoopback(a)).toBe(true);
    for (const a of ["0.0.0.0", "192.0.2.2", "::", "::ffff:10.0.0.1", "128.0.0.1", "localhost"]) expect(isLoopback(a)).toBe(false);
    expect(bindIsOpen("127.0.0.1")).toBe(false);
    expect(bindIsOpen("localhost")).toBe(false);
    expect(bindIsOpen("0.0.0.0")).toBe(true);
  });

  test("a client that reaches the port directly cannot change its address with the header", async () => {
    const s = await server({ config: { bind: "0.0.0.0" } });
    await s.signIn();
    // Reach the server by a non-loopback address of this machine, if it has one.
    const addr = Object.values((await import("node:os")).networkInterfaces()).flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (!addr) return;   // no network interface in this sandbox: the unit test above covers it
    const base = `http://${addr}:${s.port}`;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await login(s, "wrong password", { "CF-Connecting-IP": `198.51.100.${i}` }, base)).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    // over loopback (the tunnel) the header is still believed
    expect((await login(s, "wrong password", { "CF-Connecting-IP": "198.51.100.200" })).status).toBe(401);
  });

  test("an https public address with an open bind logs a warning at start", async () => {
    const open = await server({ config: { bind: "0.0.0.0", publicUrl: "https://quiz.example.com" } });
    expect(open.logs).toContain("This port is open to the network. Lock-In expects to sit behind the tunnel on 127.0.0.1.");
    const closed = await server({ config: { publicUrl: "https://quiz.example.com" } });
    expect(closed.logs.some((l) => l.includes("open to the network"))).toBe(false);
  });
});

describe("SA-08: sign-in limits", () => {
  test("blocks double: 1 minute, then 2, 4, 8, and at most 15; a good sign-in resets", () => {
    const clock = new FakeClock();
    const lim = new RateLimiter(clock);
    const lengths: number[] = [];
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 5; i++) lim.fail("ip");
      expect(lim.blocked("ip")).toBe(true);
      lengths.push(lim.blockedFor("ip") / 60_000);
      clock.advance(lim.blockedFor("ip"));
      expect(lim.blocked("ip")).toBe(false);
    }
    expect(lengths).toEqual([1, 2, 4, 8, 15, 15]);
    lim.succeed("ip");
    for (let i = 0; i < 5; i++) lim.fail("ip");
    expect(lim.blockedFor("ip")).toBe(60_000);
  });

  test("past 10,000 keys the oldest are dropped, and the newest failure counts are kept", () => {
    const lim = new RateLimiter(new FakeClock());
    for (let i = 0; i < 10_001; i++) lim.fail(`k${i}`);
    for (let i = 0; i < 4; i++) lim.fail("attacker");
    lim.fail("attacker");
    expect(lim.blocked("attacker")).toBe(true);
    for (let i = 0; i < 4; i++) lim.fail("k10000");   // k10000 was among the newest: its first failure still counts
    expect(lim.blocked("k10000")).toBe(true);
    expect(lim.size.failures).toBeLessThanOrEqual(10_000);
  });

  test("HashGate: 20 at once never run more than 2 hashes together; 10 are refused as busy", async () => {
    const gate = new HashGate();
    let running = 0, most = 0;
    const slow = async () => { running++; most = Math.max(most, running); await Bun.sleep(20); running--; return true; };
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => gate.run(slow)));
    expect(most).toBe(2);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(10);   // 2 running + 8 waiting
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof Busy).length).toBe(10);
    expect(await gate.run(slow)).toBe(true);   // and it is free again afterwards
  });

  test("20 logins at once: at most 2 hashes run, the rest wait or get 429 busy, which is not a wrong try", async () => {
    let running = 0, most = 0;
    const hasher: PasswordHasher = {
      hash: async (p) => `fake:${p}`,
      verify: async (p, h) => { running++; most = Math.max(most, running); await Bun.sleep(30); running--; return h === `fake:${p}`; },
    };
    const s = await server({ hasher });
    await s.signIn();
    const statuses = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      login(s, TEST_PASSWORD, { "CF-Connecting-IP": `203.0.113.${i}` }).then(async (r) => r.status === 429 ? (await r.json()).error.code : r.status)));
    expect(most).toBeLessThanOrEqual(2);
    expect(statuses.filter((x) => x === 200).length).toBeGreaterThanOrEqual(10);
    expect(statuses.filter((x) => x !== 200).every((x) => x === "busy")).toBe(true);
  });

  test("the sixth wrong login blocks for a minute and says so; the next block is 2 minutes", async () => {
    const clock = new FakeClock();
    const s = await server({ clock });
    await s.signIn();
    for (let i = 0; i < 5; i++) expect((await login(s, "nope nope nope")).status).toBe(401);
    let res = await login(s, TEST_PASSWORD);
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("Too many wrong tries. Wait a minute and try again.");
    clock.advance(60_000);
    for (let i = 0; i < 5; i++) expect((await login(s, "nope nope nope")).status).toBe(401);
    res = await login(s, TEST_PASSWORD);
    expect((await res.json()).error.message).toBe("Too many wrong tries. Wait 2 minutes and try again.");
    clock.advance(120_000);
    expect((await login(s, TEST_PASSWORD)).status).toBe(200);
  });
});

describe("SA-09: an exception in a timer does not end the process", () => {
  test("a job that throws is logged, and the next job still fires", async () => {
    const logs: string[] = [];
    const s = new ClockScheduler({ now: () => Date.now() }, (m) => logs.push(m));
    let ran = false;
    s.at(Date.now() + 5, () => { throw new Error("disk full"); });
    s.at(Date.now() + 15, () => { ran = true; });
    await Bun.sleep(80);
    s.stop();
    expect(ran).toBe(true);
    expect(logs[0]).toContain("A timed job failed: Error: disk full");
  });

  test("the same on fake time: runDue goes on past a job that throws and re-arms", () => {
    const clock = new FakeClock();
    const s = new ClockScheduler(clock, () => {});
    const order: string[] = [];
    s.at(clock.now() + 10, () => { order.push("a"); throw new Error("boom"); });
    s.at(clock.now() + 10, () => order.push("b"));
    s.at(clock.now() + 20, () => order.push("c"));
    clock.advance(10);
    s.runDue();
    clock.advance(10);
    s.runDue();
    s.stop();
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("a lock the database refuses to save is retried until it saves; the night carries on", () => {
    const logs: string[] = [];
    const r = rig({ log: (m) => logs.push(m) });
    rigs.push(r);
    writeQuiz(r.dataDir, makeQuiz("friday", [[q(text("Fleetwood Mac")), q(text("Abbey Road"))]], { timerSeconds: 30 }));
    host(r, "night.open", { quizId: "friday" });
    joinTeam(r, "Pub Fiction");
    host(r, "quiz.start");
    host(r, "round.start");
    host(r, "question.next");
    host(r, "timer.start");
    const qid = Object.keys(r.engine.state.questions)[0]!;
    // Every write fails, as with a full disk.
    const db = (r.engine as unknown as { d: { db: { transaction: (fn: () => void) => () => void } } }).d.db;
    const real = db.transaction.bind(db);
    db.transaction = () => () => { throw new Error("database or disk is full"); };
    r.advance(30_000);   // the lock fires and cannot be saved
    expect(r.engine.state.questions[qid]!.status).toBe("open");
    expect(logs.some((l) => l.startsWith("The lock could not be saved; trying again in 2 s: database or disk is full"))).toBe(true);
    r.advance(TIMER_RETRY_MS);   // still failing: tried again, still open, nothing thrown
    expect(r.engine.state.questions[qid]!.status).toBe("open");
    db.transaction = real;
    r.advance(TIMER_RETRY_MS);   // the disk has room again: the lock is saved
    expect(r.engine.state.questions[qid]!.status).not.toBe("open");
  });

  test("an uncaught error is logged with what happened, then the process exits 1", () => {
    const lines: string[] = [];
    let code = -1;
    crashHandler((m) => lines.push(m), (c) => { code = c; })("An error nobody caught", new Error("kaboom"));
    expect(code).toBe(1);
    expect(lines[0]).toStartWith("An error nobody caught. Lock-In is stopping so it can be restarted cleanly: Error: kaboom");
  });
});

describe("SA-10: the data folder is for the server's user only", () => {
  const mode = (p: string) => statSync(p).mode & 0o777;

  test("a first start on an empty folder: folder 0700, database and -wal 0600, auth.json 0600", async () => {
    const parent = mkdtempSync(join(tmpdir(), "lockin-modes-"));
    dirs.push(parent);
    const dataDir = join(parent, "data");   // not made by mkdtemp, so it starts with the default mode
    const s = await server({ dataDir });
    await s.signIn();
    expect(mode(dataDir)).toBe(0o700);
    expect(mode(join(dataDir, "quizzes"))).toBe(0o700);
    expect(mode(join(dataDir, "lockin.db"))).toBe(0o600);
    expect(mode(join(dataDir, "lockin.db-wal"))).toBe(0o600);
    expect(mode(join(dataDir, "auth.json"))).toBe(0o600);
  });

  test("an existing open folder and database are tightened at start", async () => {
    const parent = mkdtempSync(join(tmpdir(), "lockin-modes-"));
    dirs.push(parent);
    const dataDir = join(parent, "data");
    mkdirSync(dataDir, { mode: 0o755 });
    const first = await startTestServer({ dataDir });
    await first.stop();
    const { chmodSync } = await import("node:fs");
    chmodSync(dataDir, 0o755);
    chmodSync(join(dataDir, "lockin.db"), 0o644);
    await server({ dataDir });
    expect(mode(dataDir)).toBe(0o700);
    expect(mode(join(dataDir, "lockin.db"))).toBe(0o600);
  });

  test("writeTextAtomic replaces a stale, open temp file and ends with the asked mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockin-modes-"));
    dirs.push(dir);
    const path = join(dir, "auth.json");
    writeFileSync(`${path}.tmp`, "stale", { mode: 0o644 });
    writeTextAtomic(path, "{}\n", 0o600);
    expect(mode(path)).toBe(0o600);
  });
});

describe("SA-12: host sessions end on time, also for an open socket", () => {
  async function hostSocket(s: TestServer, cookie: string) {
    const c = await connectClient(s, { role: "host", cookie });
    clients.push(c);
    await c.hello();
    return c;
  }

  test("a host socket whose session expires gets bye signed_out at the next sweep, and the row is deleted", async () => {
    const clock = new FakeClock();
    const s = await server({ clock });
    const cookie = await s.signIn();
    const c = await hostSocket(s, cookie);
    clock.advance(SESSION_DAYS * DAY + 1);   // a week with no activity at all
    const states = c.received.filter((m) => m.t === "state").length;
    expect(sweepSessions(s.app)).toEqual({ closed: 1, deleted: 1 });
    const bye = await c.next("bye");
    expect(bye.reason).toBe("signed_out");
    expect(await c.closed).toBe(1000);
    expect(c.received.filter((m) => m.t === "state").length).toBe(states);   // nothing after the bye
    expect(s.app.db.query("SELECT COUNT(*) AS n FROM host_sessions").get()).toEqual({ n: 0 });
  });

  test("an active host socket keeps its session alive past 7 days", async () => {
    const clock = new FakeClock();
    const s = await server({ clock });
    const cookie = await s.signIn();
    const c = await hostSocket(s, cookie);
    for (let day = 0; day < 10; day++) {
      clock.advance(DAY);
      c.send({ t: "ping", c: day });
      await c.next("pong");
    }
    expect(sweepSessions(s.app).closed).toBe(0);
    expect((await c.cmd("display.unpairAll", {})).ok).toBe(true);
    expect((await s.fetch("/api/auth/status", { cookie }).then((r) => r.json())).signedIn).toBe(true);
  });

  test("a session ends 30 days after sign-in however much it is used", async () => {
    const clock = new FakeClock();
    const s = await server({ clock });
    const cookie = await s.signIn();
    const c = await hostSocket(s, cookie);
    for (let day = 0; day < SESSION_MAX_DAYS; day++) {
      clock.advance(DAY);
      c.send({ t: "ping", c: day });
      await c.next(day === SESSION_MAX_DAYS - 1 ? "bye" : "pong");
    }
    expect(c.received.some((m: ServerMsg) => m.t === "bye" && m.reason === "signed_out")).toBe(true);
    expect((await s.fetch("/api/auth/status", { cookie }).then((r) => r.json())).signedIn).toBe(false);
    // the ended row is gone (the cookie check above deletes it; the sweep would otherwise)
    expect(s.app.db.query("SELECT COUNT(*) AS n FROM host_sessions").get()).toEqual({ n: 0 });
  });
});
