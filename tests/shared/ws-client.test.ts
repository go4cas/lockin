import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { loadBrowserScripts, type BrowserClient, type LockInGlobal } from "../helpers/browser-scripts.ts";
import { TEST_PUBLIC_URL, startTestServer, type TestServer } from "../helpers/server.ts";

let LockIn: LockInGlobal;
beforeAll(() => {
  LockIn = loadBrowserScripts("public/shared/clock.js", "public/shared/ws-client.js", "public/shared/view.js");
});

const servers: TestServer[] = [];
const clients: BrowserClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of servers.splice(0)) await s.stop();
});

async function server(opts: Parameters<typeof startTestServer>[0] = {}) {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
}

/** Bun's WebSocket with the Origin and Cookie a browser would send. */
function socketFactory(cookie?: string) {
  return (url: string) => new WebSocket(url, { headers: { Origin: TEST_PUBLIC_URL, ...(cookie ? { Cookie: cookie } : {}) } } as unknown as string[]);
}

function connect(s: TestServer, opts: Record<string, unknown>) {
  const events: { t: string; v?: unknown }[] = [];
  const c = LockIn.connect({
    url: s.wsUrl,
    createSocket: socketFactory(opts.cookie as string | undefined),
    onState: (view: unknown) => events.push({ t: "state", v: view }),
    onStatus: (st: string) => events.push({ t: "status", v: st }),
    onWelcome: (m: unknown) => events.push({ t: "welcome", v: m }),
    onBye: (r: string) => events.push({ t: "bye", v: r }),
    ...opts,
  });
  clients.push(c);
  return { c, events };
}

async function until(fn: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await Bun.sleep(10);
  }
}

describe("ws-client.js against the server", () => {
  test("says hello, renders the state and goes online", async () => {
    const s = await server();
    const { c, events } = connect(s, { role: "tv" });
    await until(() => c.status === "online");
    expect(events.map((e) => e.t)).toEqual(["welcome", "status", "state"]);
    expect(c.view.role).toBe("tv");
  });

  test("sends the team token from getToken in hello", async () => {
    const s = await server();
    s.app.ws.setTeamTokenResolver((t) => (t === "tok-1" ? "t-team0001" : null));
    const { c } = connect(s, { role: "team", getToken: () => "tok-1" });
    await until(() => c.status === "online");
    expect(c.teamId).toBe("t-team0001");
  });

  test("cmd resolves with the ack's result or rejects with its error", async () => {
    const s = await server();
    const cookie = await s.signIn();
    s.app.ws.setCommandHandler((_conn, name) => (name === "lock" ? { ok: true, result: { locked: true } } : { ok: false, error: { code: "wrong_phase", message: "Not now." } }));
    const { c } = connect(s, { role: "host", cookie });
    await until(() => c.status === "online");
    expect(await c.cmd("lock")).toEqual({ locked: true });
    await expect(c.cmd("quiz.start")).rejects.toEqual({ code: "wrong_phase", message: "Not now." });
  });

  test("cmd rejects at once while disconnected", async () => {
    const s = await server();
    const { c } = connect(s, { role: "tv" });
    await expect(c.cmd("lock")).rejects.toMatchObject({ code: "disconnected" });
  });

  test("reconnects after the server restarts, shows offline meanwhile, and gets the current state", async () => {
    const s1 = await startTestServer({ keepData: true });
    const { c, events } = connect(s1, { role: "tv", offlineAfterMs: 100, random: () => 0 });
    await until(() => c.status === "online");
    const port = s1.port;
    await s1.stop();
    await until(() => c.status === "offline");
    const s2 = await server({ dataDir: s1.dataDir, config: { port } });
    s2.app.ws.setViewProvider((conn) => ({ seq: 3, view: { ...(c.view), venue: { name: "after restart", themeVersion: "v", teamColours: 8 }, role: conn.role } }));
    await until(() => c.status === "online", 8000);
    expect(c.view.venue.name).toBe("after restart");
    expect(events.filter((e) => e.t === "welcome")).toHaveLength(2);
    expect(events.filter((e) => e.t === "status").map((e) => e.v)).toEqual(["online", "offline", "online"]);
  }, 15_000);

  test("a host signed out gets onBye and stops reconnecting", async () => {
    const s = await server();
    const { c, events } = connect(s, { role: "host" });   // no cookie
    await until(() => events.some((e) => e.t === "bye"));
    expect(events.find((e) => e.t === "bye")!.v).toBe("signed_out");
    expect(c.stopped).toBe(true);
  });

  test("keeps the clock offset from pongs", async () => {
    const s = await server();
    const { c } = connect(s, { role: "tv" });
    await until(() => c.status === "online");
    await Bun.sleep(100);   // first ping went out on open
    expect(Math.abs(c.clock.offset())).toBeLessThan(1000);
  });
});

describe("ws-client.js state ordering", () => {
  test("ignores a state older than the last one rendered; a new welcome resets", () => {
    const states: number[] = [];
    const c = LockIn.connect({ role: "tv", url: "ws://unused", createSocket: () => ({ readyState: 0, send() {}, close() {} }), onState: (_v: unknown, m: { seq: number }) => states.push(m.seq) });
    clients.push(c);
    const state = (seq: number) => ({ t: "state", seq, serverNow: 0, view: { phase: "idle" } });
    c.receive({ t: "welcome", protocol: 1, role: "tv", serverNow: Date.now(), teamId: null });
    c.receive(state(5));
    c.receive(state(4));
    c.receive(state(5));
    c.receive(state(6));
    c.receive({ t: "welcome", protocol: 1, role: "tv", serverNow: Date.now(), teamId: null });
    c.receive(state(1));
    expect(states).toEqual([5, 5, 6, 1]);
  });
});

describe("backoff (TECH-SPEC 11.1)", () => {
  test("0.5, 1, 2, 4, then every 5 s, with up to 30% jitter", () => {
    expect([0, 1, 2, 3, 4, 10].map((n) => LockIn.backoff(n, () => 0))).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
    expect([0, 4].map((n) => LockIn.backoff(n, () => 0.999))).toEqual([650, 6499]);
  });
});

describe("clock.js (TECH-SPEC 10.6)", () => {
  test("offset = s - (c + rtt/2), median of the last five", () => {
    const clock = new LockIn.Clock();
    // c=1000, arrives at 1100 (rtt 100), server said 6050: offset 6050 - 1050 = 5000
    expect(clock.sample(1000, 6050, 1100)).toBe(5000);
    clock.sample(2000, 7050, 2100);          // 5000
    clock.sample(3000, 9050, 3100);          // 6000 (outlier)
    expect(clock.offset()).toBe(5000);
    for (let i = 0; i < 5; i++) clock.sample(4000, 4050 + 100, 4100);   // offset 100, pushes the old ones out
    expect(clock.offset()).toBe(100);
  });

  test("remaining() counts down to a server time and never goes below 0", () => {
    const clock = new LockIn.Clock();
    clock.seed(Date.now() + 10_000);         // server is 10 s ahead
    const r = clock.remaining(Date.now() + 15_000);
    expect(r).toBeGreaterThan(4_000);
    expect(r).toBeLessThanOrEqual(5_000);
    expect(clock.remaining(0)).toBe(0);
  });
});

describe("view.js helpers", () => {
  test("countdown, joinNames, teamColour", () => {
    expect(LockIn.view.countdown(65_000)).toBe("1:05");
    expect(LockIn.view.countdown(9_100, true)).toBe("10");
    expect(LockIn.view.countdown(-5)).toBe("0:00");
    expect(LockIn.view.joinNames(["A"])).toBe("A");
    expect(LockIn.view.joinNames(["A", "B"])).toBe("A and B");
    expect(LockIn.view.joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect(LockIn.view.teamColour(3)).toBe("var(--team-3)");
  });
});
