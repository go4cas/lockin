// SA-04 / LI-011: caps on sockets and messages; SA-03 / D2 / LI-014: pairing codes are never
// evicted or moved, are capped, expire, and pairing writes commit only after the file write.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DisplayView, HostView, ServerMsg } from "../../src/shared/protocol.ts";
import { DisplayPairing, MAX_WAITING, MAX_WAITING_PER_IP, PAIR_CODE_TTL_MS } from "../../src/server/display/pairing.ts";
import { sweepPairing } from "../../src/server/display/index.ts";
import { BACKPRESSURE_LIMIT, MAX_MESSAGE_BYTES, MAX_SOCKETS_PER_IP, MESSAGE_BURST } from "../../src/server/ws.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { TEST_PUBLIC_URL, startTestServer, type TestServer } from "../helpers/server.ts";

const open: TestClient[] = [];
const servers: TestServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (open.length) open.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function server(clock = new FakeClock()) {
  const s = await startTestServer({ clock });
  servers.push(s);
  return { s, clock };
}
async function client(s: TestServer, role: "host" | "display" | "team" | null, opts: { cookie?: string; ip?: string; token?: string } = {}) {
  const c = await connectClient(s, { cookie: opts.cookie, headers: opts.ip ? { "CF-Connecting-IP": opts.ip } : {} });
  open.push(c);
  if (role) await c.hello({ role, ...(opts.token ? { token: opts.token } : {}) });
  return c;
}
const states = (c: TestClient) => c.received.filter((m): m is Extract<ServerMsg, { t: "state" }> => m.t === "state");
const lastView = <T>(c: TestClient) => states(c).at(-1)!.view as T;
const pairCode = (c: TestClient) => lastView<DisplayView>(c).pairing?.code ?? null;

describe("socket caps (SA-04)", () => {
  test("the 121st socket from one IP is refused at upgrade; other IPs still connect", async () => {
    const { s } = await server();
    const ip = "203.0.113.20";
    for (let i = 0; i < MAX_SOCKETS_PER_IP; i++) await client(s, null, { ip });
    const refused = await fetch(`${s.base}/ws`, { headers: { Origin: TEST_PUBLIC_URL, "CF-Connecting-IP": ip, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" } });
    expect(refused.status).toBe(429);
    await expect(client(s, null, { ip })).rejects.toThrow();
    expect(s.app.ws.socketsOpen(ip)).toBe(MAX_SOCKETS_PER_IP);
    await client(s, "team", { ip: "203.0.113.21" });
    // a closed socket gives its place back
    open.shift()!.close();
    await Bun.sleep(100);
    expect(s.app.ws.socketsOpen(ip)).toBe(MAX_SOCKETS_PER_IP - 1);
    await client(s, null, { ip });
  }, 20_000);

  test("100 messages in one second: the socket gets bye(protocol)", async () => {
    const { s } = await server();
    const c = await client(s, "team");
    for (let i = 0; i < 100; i++) c.ws.send(JSON.stringify({ t: "ping", c: i }));
    expect(await c.closed).toBe(1000);
    expect(c.received.some((m) => m.t === "bye" && m.reason === "protocol")).toBe(true);
    expect(c.received.filter((m) => m.t === "pong").length).toBeLessThanOrEqual(MESSAGE_BURST);
  });

  test("a phone answering at a human pace is never limited", async () => {
    const { s } = await server();
    const c = await client(s, "team");
    for (let i = 0; i < 30; i++) {
      c.ws.send(JSON.stringify({ t: "ping", c: i }));
      await Bun.sleep(110);
    }
    await Bun.sleep(50);
    expect(c.received.filter((m) => m.t === "pong").length).toBe(30);
    expect(c.received.some((m) => m.t === "bye")).toBe(false);
  }, 10_000);

  test("frame size and backpressure limits are set", async () => {
    const { s } = await server();
    expect(s.app.ws.websocket.maxPayloadLength).toBe(MAX_MESSAGE_BYTES);
    expect(MAX_MESSAGE_BYTES).toBe(32 * 1024);
    expect(s.app.ws.websocket.backpressureLimit).toBe(BACKPRESSURE_LIMIT);
    expect(BACKPRESSURE_LIMIT).toBe(1024 * 1024);
    expect(s.app.ws.websocket.closeOnBackpressureLimit).toBe(true);
    const c = await client(s, "team");
    c.ws.send(JSON.stringify({ t: "ping", c: 1, pad: "x".repeat(MAX_MESSAGE_BYTES) }));
    expect(await c.closed).not.toBe(0);
  });

  test("100 display connects send a host far fewer than 100 states (coalesced, SA-03 step 5)", async () => {
    const { s } = await server();
    const cookie = await s.signIn();
    const host = await client(s, "host", { cookie });
    await Bun.sleep(300);
    const before = states(host).length;
    await Promise.all(Array.from({ length: 100 }, (_, i) => client(s, "display", { ip: `198.51.100.${i}` })));
    await Bun.sleep(400);
    const sent = states(host).length - before;
    console.log(`[SA-04] 100 display connects sent the host ${sent} states`);
    expect(sent).toBeLessThan(15);
    expect(lastView<HostView>(host).displays!.waiting).toBe(100);
  }, 20_000);
});

describe("pairing codes under a flood (SA-03, D2)", () => {
  test("with 25 unpaired displays open, the first one's code still pairs the first one; socket 21 has no code", async () => {
    const { s } = await server();
    const cookie = await s.signIn();
    const host = await client(s, "host", { cookie });
    const tvs: TestClient[] = [];
    for (let i = 0; i < 25; i++) tvs.push(await client(s, "display", { ip: `192.0.2.${Math.floor(i / 4)}` }));
    const codes = tvs.map(pairCode);
    expect(codes.slice(0, MAX_WAITING).every((c) => /^[0-9]{6}$/.test(c!))).toBe(true);
    expect(new Set(codes.slice(0, MAX_WAITING)).size).toBe(MAX_WAITING);
    expect(codes.slice(MAX_WAITING).every((c) => c === "")).toBe(true);
    const ack = await host.cmd("display.pair", { code: codes[0] });
    expect(ack.ok).toBe(true);
    await Bun.sleep(100);
    expect(tvs[0]!.received.some((m) => m.t === "paired")).toBe(true);
    expect(tvs.slice(1).some((c) => c.received.some((m) => m.t === "paired"))).toBe(false);
  }, 20_000);

  test("at most 5 waiting displays per IP; a freed place goes to one that was turned away", async () => {
    const { s } = await server();
    const tvs: TestClient[] = [];
    for (let i = 0; i < MAX_WAITING_PER_IP + 2; i++) tvs.push(await client(s, "display", { ip: "192.0.2.77" }));
    expect(tvs.map(pairCode).filter((c) => c).length).toBe(MAX_WAITING_PER_IP);
    tvs[0]!.close();
    await Bun.sleep(150);
    expect(tvs.slice(1).map(pairCode).filter((c) => c).length).toBe(MAX_WAITING_PER_IP);
  });

  test("codes expire after 10 minutes and the display is sent its new code at once", async () => {
    const { s, clock } = await server();
    const tv = await client(s, "display", { ip: "192.0.2.5" });
    const first = pairCode(tv)!;
    clock.advance(PAIR_CODE_TTL_MS - 1000);
    sweepPairing(s.app);
    expect(pairCode(tv)).toBe(first);
    clock.advance(2000);
    sweepPairing(s.app);
    await Bun.sleep(100);
    const second = pairCode(tv)!;
    expect(second).toMatch(/^[0-9]{6}$/);
    expect(second).not.toBe(first);
    // the old code no longer pairs anything
    expect(s.app.services.displayPairing!.claim(first)).toEqual({ error: "bad_code" });
  });

  test("property: no code is ever held by two open connections or moved from one to another", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockin-pair-"));
    dirs.push(dir);
    const clock = new FakeClock();
    const p = new DisplayPairing(dir, clock);
    const openIds = new Set<number>();
    const seen = new Map<number, string>();
    let next = 1;
    let seed = 42;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let step = 0; step < 5000; step++) {
      const r = rand(10);
      if (r < 5 || openIds.size === 0) {
        const id = next++;
        openIds.add(id);
        const c = p.codeFor(id, `10.0.0.${rand(8)}`);
        if (c) seen.set(id, c);
      } else if (r < 9) {
        const ids = [...openIds];
        const id = ids[rand(ids.length)]!;
        openIds.delete(id);
        seen.delete(id);
        p.forget(id);
      } else {
        clock.advance(rand(60_000));
      }
      // every open connection that has a code keeps it (until expiry), and codes are unique
      const held = new Map<string, number>();
      for (const id of openIds) {
        if (!p.holds(id)) continue;
        const c = p.waiting(id)!.code;
        if (held.has(c)) throw new Error(`code ${c} held by ${held.get(c)} and ${id}`);
        held.set(c, id);
        const expired = clock.now() - p.waiting(id)!.at >= PAIR_CODE_TTL_MS;
        if (!expired && seen.has(id)) expect(c).toBe(seen.get(id)!);
      }
      expect(p.waitingCount).toBeLessThanOrEqual(MAX_WAITING);
    }
  });
});

describe("pairing writes commit only after the file write (LI-014)", () => {
  function brokenPairing() {
    const dir = mkdtempSync(join(tmpdir(), "lockin-pair-"));
    dirs.push(dir);
    const p = new DisplayPairing(dir, new FakeClock());
    const token = p.issue();
    const file = readFileSync(join(dir, "displays.json"), "utf8");
    mkdirSync(join(dir, "displays.json.tmp"));   // every later write fails
    return { dir, p, token, file };
  }

  test("a failed unpairAll leaves the old token valid in memory and on disk", () => {
    const { dir, p, token, file } = brokenPairing();
    expect(() => p.unpairAll()).toThrow();
    expect(p.isPaired(token)).toBe(true);
    expect(readFileSync(join(dir, "displays.json"), "utf8")).toBe(file);
    expect(new DisplayPairing(dir, new FakeClock()).isPaired(token)).toBe(true);
  });

  test("a failed issue adds nothing, and the visible code can be tried again", () => {
    const { p } = brokenPairing();
    const before = p.pairedCount;
    const code = p.codeFor(7, "192.0.2.1");
    expect(p.claim(code)).toEqual({ connId: 7 });
    expect(() => p.issue()).toThrow();
    expect(p.pairedCount).toBe(before);
    expect(p.claim(code)).toEqual({ connId: 7 });   // not used up by the failed attempt
  });

  test("a successful unpairAll revokes old tokens across a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockin-pair-"));
    dirs.push(dir);
    const p = new DisplayPairing(dir, new FakeClock());
    const token = p.issue();
    expect(p.unpairAll()).toBe(1);
    expect(p.isPaired(token)).toBe(false);
    expect(new DisplayPairing(dir, new FakeClock()).isPaired(token)).toBe(false);
  });
});
